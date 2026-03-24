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

  // 1. Remove JS-style comments (// ... and /* ... */)
  s = s.replace(/\/\/[^\n]*/g, "");
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

  // Try strict parse first
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Fallback: sanitize common LLM JSON errors and retry
    const sanitized = sanitizeJSON(jsonStr);
    try {
      return JSON.parse(sanitized) as T;
    } catch {
      // Last resort: re-extract after sanitization
      try {
        const reExtracted = extractBalancedJSON(sanitized);
        return JSON.parse(reExtracted) as T;
      } catch (e) {
        throw new Error(
          `JSON invalide après sanitization : ${(e as Error).message}\nDébut: ${jsonStr.slice(0, 300)}`
        );
      }
    }
  }
}
