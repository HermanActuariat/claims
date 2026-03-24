import { describe, it, expect } from "vitest";
import { parseAIResponse } from "@/lib/ai-utils";

describe("parseAIResponse", () => {
  it("parses valid JSON directly", () => {
    const result = parseAIResponse<{ score: number }>('{"score": 42}');
    expect(result).toEqual({ score: 42 });
  });

  it("parses JSON from code block", () => {
    const input = '```json\n{"score": 42}\n```';
    const result = parseAIResponse<{ score: number }>(input);
    expect(result).toEqual({ score: 42 });
  });

  it("parses JSON from code block without json tag", () => {
    const input = '```\n{"score": 42}\n```';
    const result = parseAIResponse<{ score: number }>(input);
    expect(result).toEqual({ score: 42 });
  });

  it("handles trailing commas before closing brace", () => {
    const input = '{"score": 42, "risk": "low",}';
    const result = parseAIResponse<{ score: number; risk: string }>(input);
    expect(result).toEqual({ score: 42, risk: "low" });
  });

  it("handles trailing commas before closing bracket", () => {
    const input = '{"items": [1, 2, 3,]}';
    const result = parseAIResponse<{ items: number[] }>(input);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("handles JS-style single-line comments", () => {
    const input = `{
      // This is a comment
      "score": 42
    }`;
    const result = parseAIResponse<{ score: number }>(input);
    expect(result).toEqual({ score: 42 });
  });

  it("handles JS-style multi-line comments", () => {
    const input = `{
      /* multi-line
         comment */
      "score": 42
    }`;
    const result = parseAIResponse<{ score: number }>(input);
    expect(result).toEqual({ score: 42 });
  });

  it("handles text wrapping around JSON", () => {
    const input = 'Here is the analysis result:\n{"score": 42}\nEnd of analysis.';
    const result = parseAIResponse<{ score: number }>(input);
    expect(result).toEqual({ score: 42 });
  });

  it("handles missing commas between object properties", () => {
    const input = '{"score": 42\n"risk": "low"}';
    const result = parseAIResponse<{ score: number; risk: string }>(input);
    expect(result).toEqual({ score: 42, risk: "low" });
  });

  it("handles truncated JSON by auto-closing", () => {
    const input = '{"score": 42, "factors": [{"name": "delay"';
    const result = parseAIResponse<{ score: number; factors: { name: string }[] }>(input);
    expect(result.score).toBe(42);
    expect(result.factors).toBeDefined();
  });

  it("handles nested objects", () => {
    const input = '{"fraud": {"score": 75, "risk": "high"}, "estimation": {"total": 5000}}';
    const result = parseAIResponse<{
      fraud: { score: number; risk: string };
      estimation: { total: number };
    }>(input);
    expect(result.fraud.score).toBe(75);
    expect(result.estimation.total).toBe(5000);
  });

  it("handles arrays of objects", () => {
    const input = '{"factors": [{"name": "delay", "weight": 5}, {"name": "amount", "weight": 3}]}';
    const result = parseAIResponse<{ factors: { name: string; weight: number }[] }>(input);
    expect(result.factors).toHaveLength(2);
    expect(result.factors[0].name).toBe("delay");
  });

  it("handles boolean and null values", () => {
    const input = '{"active": true, "deleted": false, "notes": null}';
    const result = parseAIResponse<{ active: boolean; deleted: boolean; notes: null }>(input);
    expect(result.active).toBe(true);
    expect(result.deleted).toBe(false);
    expect(result.notes).toBeNull();
  });

  it("throws on completely invalid input", () => {
    expect(() => parseAIResponse("no json here at all")).toThrow();
  });

  it("throws on empty input", () => {
    expect(() => parseAIResponse("")).toThrow();
  });

  it("handles real-world fraud analysis response shape", () => {
    const input = `\`\`\`json
{
  "score": 35,
  "risk": "medium",
  "factors": [
    {"name": "Déclaration tardive", "description": "Délai supérieur à 5 jours", "weight": 15},
    {"name": "Montant élevé", "description": "Montant supérieur au seuil", "weight": 20}
  ],
  "summary": "Risque modéré détecté",
  "recommendation": "Vérification manuelle recommandée"
}
\`\`\``;
    const result = parseAIResponse<{
      score: number;
      risk: string;
      factors: { name: string; description: string; weight: number }[];
      summary: string;
      recommendation: string;
    }>(input);
    expect(result.score).toBe(35);
    expect(result.risk).toBe("medium");
    expect(result.factors).toHaveLength(2);
    expect(result.summary).toBeTruthy();
  });

  it("handles JSON with control characters in strings", () => {
    const input = '{"description": "Line1\\nLine2\\tTabbed"}';
    const result = parseAIResponse<{ description: string }>(input);
    expect(result.description).toContain("Line1");
  });

  it("handles missing commas between array objects", () => {
    const input = '{"items": [{"a": 1}\n{"b": 2}]}';
    const result = parseAIResponse<{ items: { a?: number; b?: number }[] }>(input);
    expect(result.items).toHaveLength(2);
  });
});
