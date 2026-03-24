/**
 * Shared AI response parsing utilities
 */

/**
 * Aggressively fix common JSON syntax errors produced by LLMs:
 * - Trailing commas before ] or }
 * - JS-style single-line and multi-line comments
 * - Missing commas between array or object elements
 * - Control characters
 * - Text after the JSON closing brace
 */
function sanitizeJSON(raw: string): string {
  let s = raw;

  // 1. Remove multi-line JS comments only (single-line // removal
  // is skipped because it corrupts URLs like "https://...")
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. Remove control characters (keep \n \r \t)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  // 3. Fix missing commas between objects in arrays: }\n  { → },\n  {
  s = s.replace(/\}(\s*)\{/g, "},$1{");

  // 4. Fix missing commas between array elements: ]\n  [ → ],\n  [
  s = s.replace(/\](\s*)\[/g, "],$1[");

  // 5. Fix missing commas after string/number/bool/null before a key: "value"\n  "key"
  s = s.replace(/(["}\]\d]|true|false|null)\s*\n(\s*")/g, "$1,\n$2");

  // 6. Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}

/**
 * Character-by-character JSON repair using a state machine.
 * Handles: unescaped quotes in strings, trailing commas, missing commas,
 * truncated JSON (auto-closes open brackets/braces), JS comments.
 */
function repairJSON(input: string): string {
  // Pre-clean: remove code fences and JS comments outside strings
  let raw = input.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();

  // Remove single-line comments outside strings
  raw = raw.replace(/\/\/[^\n]*/g, "");
  // Remove multi-line comments outside strings
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, "");

  // Find the first { or [
  const startIdx = raw.search(/[{[]/);
  if (startIdx === -1) throw new Error("No JSON structure found");
  raw = raw.slice(startIdx);

  const result: string[] = [];
  const stack: string[] = []; // tracks open { and [
  let i = 0;
  let inString = false;
  let lastSignificantChar = "";

  while (i < raw.length) {
    const ch = raw[i];

    // Inside a string
    if (inString) {
      if (ch === "\\") {
        // Escape sequence — pass through the next char too
        result.push(ch);
        i++;
        if (i < raw.length) {
          result.push(raw[i]);
        }
        i++;
        continue;
      }
      if (ch === '"') {
        // Check if this quote is actually ending the string or is unescaped mid-string.
        // Heuristic: if next non-whitespace char is : , } ] or end-of-input, it's a real close.
        // Otherwise it might be an unescaped quote inside the string.
        const rest = raw.slice(i + 1).trimStart();
        const nextCh = rest[0];
        if (
          nextCh === undefined ||
          nextCh === ":" ||
          nextCh === "," ||
          nextCh === "}" ||
          nextCh === "]" ||
          nextCh === '"'
        ) {
          // Legitimate string close
          result.push('"');
          inString = false;
          lastSignificantChar = '"';
          i++;
          continue;
        } else {
          // Likely an unescaped quote inside a string — escape it
          result.push('\\"');
          i++;
          continue;
        }
      }
      // Control characters in strings — escape them
      if (ch === "\n") {
        result.push("\\n");
        i++;
        continue;
      }
      if (ch === "\r") {
        result.push("\\r");
        i++;
        continue;
      }
      if (ch === "\t") {
        result.push("\\t");
        i++;
        continue;
      }
      result.push(ch);
      i++;
      continue;
    }

    // Outside a string
    // Skip whitespace
    if (/\s/.test(ch)) {
      result.push(ch);
      i++;
      continue;
    }

    if (ch === '"') {
      // Before opening a new string, check if we need a comma
      // (e.g., "value" "key" should become "value", "key")
      if (
        lastSignificantChar === '"' ||
        lastSignificantChar === "}" ||
        lastSignificantChar === "]" ||
        /\d/.test(lastSignificantChar) ||
        lastSignificantChar === "e" || // true/false/null end chars
        lastSignificantChar === "l"
      ) {
        // Check if we actually need a comma (not already there)
        const lastNonWs = result.length - 1;
        let needsComma = true;
        for (let j = lastNonWs; j >= 0; j--) {
          const c = result[j].trim();
          if (c === "") continue;
          if (c === "," || c === ":" || c === "{" || c === "[") {
            needsComma = false;
          }
          break;
        }
        if (needsComma) {
          result.push(",");
        }
      }
      result.push('"');
      inString = true;
      lastSignificantChar = '"';
      i++;
      continue;
    }

    if (ch === "{" || ch === "[") {
      // May need a comma before this
      if (
        lastSignificantChar === "}" ||
        lastSignificantChar === "]" ||
        lastSignificantChar === '"' ||
        /\d/.test(lastSignificantChar)
      ) {
        let needsComma = true;
        for (let j = result.length - 1; j >= 0; j--) {
          const c = result[j].trim();
          if (c === "") continue;
          if (c === "," || c === ":" || c === "{" || c === "[") {
            needsComma = false;
          }
          break;
        }
        if (needsComma) result.push(",");
      }
      result.push(ch);
      stack.push(ch);
      lastSignificantChar = ch;
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      // Remove trailing comma before closing
      for (let j = result.length - 1; j >= 0; j--) {
        const c = result[j].trim();
        if (c === "") continue;
        if (c === ",") {
          result[j] = "";
        }
        break;
      }
      result.push(ch);
      stack.pop();
      lastSignificantChar = ch;
      i++;
      // If stack is empty, we have a complete JSON object — stop
      if (stack.length === 0) break;
      continue;
    }

    if (ch === ",") {
      // Check if next non-whitespace is } or ] (trailing comma)
      const rest = raw.slice(i + 1).trimStart();
      if (rest[0] === "}" || rest[0] === "]") {
        // Skip trailing comma
        i++;
        continue;
      }
      result.push(",");
      lastSignificantChar = ",";
      i++;
      continue;
    }

    if (ch === ":") {
      result.push(":");
      lastSignificantChar = ":";
      i++;
      continue;
    }

    // Numbers, booleans, null
    result.push(ch);
    lastSignificantChar = ch;
    i++;
  }

  // Auto-close any unclosed structures (truncated JSON)
  while (stack.length > 0) {
    const open = stack.pop();
    if (open === "{") {
      // Remove any trailing comma
      for (let j = result.length - 1; j >= 0; j--) {
        const c = result[j].trim();
        if (c === "") continue;
        if (c === "," || c === ":") {
          result[j] = "";
        }
        break;
      }
      result.push("}");
    } else if (open === "[") {
      for (let j = result.length - 1; j >= 0; j--) {
        const c = result[j].trim();
        if (c === "") continue;
        if (c === ",") {
          result[j] = "";
        }
        break;
      }
      result.push("]");
    }
  }

  return result.join("");
}

/**
 * Extract the outermost balanced JSON object from a string.
 * Handles cases where the LLM adds text after the JSON.
 */
function extractBalancedJSON(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // If unbalanced, return best effort (up to last })
  const lastBrace = text.lastIndexOf("}");
  return text.slice(start, lastBrace + 1);
}

/**
 * Parses an AI text response into a typed JSON object.
 * Handles code blocks, raw JSON, JSON embedded in prose,
 * and common LLM JSON formatting errors.
 * Uses a multi-stage approach: strict parse → sanitize → state-machine repair.
 */
export function parseAIResponse<T>(text: string): T {
  // Extract JSON string from various wrappings
  let jsonStr: string;

  // 1. Code block ```json ... ```
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  } else {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      jsonStr = trimmed;
    } else {
      jsonStr = text;
    }
  }

  // Use balanced extraction to avoid trailing text issues
  try {
    jsonStr = extractBalancedJSON(jsonStr);
  } catch {
    throw new Error(`Réponse IA non parseable : ${text.slice(0, 200)}`);
  }

  // Stage 1: Try strict parse
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Stage 2: Sanitize with regex and retry
    const sanitized = sanitizeJSON(jsonStr);
    try {
      return JSON.parse(sanitized) as T;
    } catch {
      // Stage 3: Full state-machine repair on original text
      try {
        const repaired = repairJSON(text);
        return JSON.parse(repaired) as T;
      } catch (e) {
        throw new Error(
          `JSON invalide après réparation : ${(e as Error).message}\nDébut: ${jsonStr.slice(0, 300)}`
        );
      }
    }
  }
}
