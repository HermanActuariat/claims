/**
 * Shared AI response parsing utilities
 */

/**
 * Fix common JSON syntax errors produced by LLMs:
 * - Trailing commas before ] or }
 * - Control characters
 */
function sanitizeJSON(raw: string): string {
  let s = raw;
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Remove control characters that break JSON (keep \n \r \t)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return s;
}

/**
 * Parses an AI text response into a typed JSON object.
 * Handles code blocks, raw JSON, JSON embedded in prose,
 * and common LLM JSON formatting errors (trailing commas, etc.).
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
      // 2. Raw JSON direct
      jsonStr = trimmed;
    } else {
      // 3. JSON embedded in prose — extract first { ... } block
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = text.slice(firstBrace, lastBrace + 1);
      } else {
        throw new Error(`Réponse IA non parseable : ${text.slice(0, 200)}`);
      }
    }
  }

  // Try strict parse first
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Fallback: sanitize common LLM JSON errors and retry
    try {
      return JSON.parse(sanitizeJSON(jsonStr)) as T;
    } catch (e) {
      throw new Error(
        `JSON invalide après sanitization : ${(e as Error).message}\nDébut: ${jsonStr.slice(0, 300)}`
      );
    }
  }
}
