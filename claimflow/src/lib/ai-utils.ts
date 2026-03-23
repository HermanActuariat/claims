/**
 * Shared AI response parsing utilities
 */

/**
 * Parses an AI text response into a typed JSON object.
 * Handles code blocks, raw JSON, and JSON embedded in prose.
 */
export function parseAIResponse<T>(text: string): T {
  // 1. Code block ```json ... ```
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return JSON.parse(codeBlock[1].trim()) as T;

  // 2. Raw JSON direct
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T;
  }

  // 3. JSON embedded in prose — extract first { ... } block
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
  }

  throw new Error(`Réponse IA non parseable : ${text.slice(0, 200)}`);
}
