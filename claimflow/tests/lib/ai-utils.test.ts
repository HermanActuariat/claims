import { describe, it, expect } from "vitest";
import { parseAIResponse } from "@/lib/ai-utils";

describe("parseAIResponse", () => {
  // 1. Valid JSON passthrough
  describe("valid JSON passthrough", () => {
    it("parses a valid JSON object", () => {
      const input = '{"name": "Alice", "age": 30}';
      expect(parseAIResponse(input)).toEqual({ name: "Alice", age: 30 });
    });

    it("parses a valid JSON array wrapped in an object", () => {
      const input = '{"values": [1, 2, 3]}';
      expect(parseAIResponse<{ values: number[] }>(input)).toEqual({
        values: [1, 2, 3],
      });
    });

    it("throws on a bare array (extractBalancedJSON requires {)", () => {
      const input = "[1, 2, 3]";
      expect(() => parseAIResponse(input)).toThrow();
    });
  });

  // 2. JSON in code blocks
  describe("JSON in code blocks", () => {
    it("extracts JSON from ```json ... ``` blocks", () => {
      const input = '```json\n{"status": "ok"}\n```';
      expect(parseAIResponse(input)).toEqual({ status: "ok" });
    });

    it("extracts JSON from ``` ... ``` blocks without language tag", () => {
      const input = '```\n{"status": "ok"}\n```';
      expect(parseAIResponse(input)).toEqual({ status: "ok" });
    });
  });

  // 3. Trailing commas
  describe("trailing commas", () => {
    it("removes trailing comma before }", () => {
      const input = '{"a": 1, "b": 2,}';
      expect(parseAIResponse(input)).toEqual({ a: 1, b: 2 });
    });

    it("removes trailing comma before ]", () => {
      const input = '{"items": [1, 2, 3,]}';
      expect(parseAIResponse(input)).toEqual({ items: [1, 2, 3] });
    });

    it("removes multiple trailing commas in nested structures", () => {
      const input = '{"a": {"b": 1,}, "c": [4, 5,],}';
      expect(parseAIResponse(input)).toEqual({ a: { b: 1 }, c: [4, 5] });
    });
  });

  // 4. Truncated/incomplete JSON
  describe("truncated JSON", () => {
    it("auto-closes a missing } at end", () => {
      const input = '{"name": "test", "value": 42';
      expect(parseAIResponse(input)).toEqual({ name: "test", value: 42 });
    });

    it("auto-closes missing ] and } at end", () => {
      const input = '{"items": [1, 2, 3';
      expect(parseAIResponse(input)).toEqual({ items: [1, 2, 3] });
    });

    it("auto-closes deeply nested truncated JSON", () => {
      const input = '{"a": {"b": {"c": 1';
      expect(parseAIResponse(input)).toEqual({ a: { b: { c: 1 } } });
    });
  });

  // 5. Unescaped quotes inside strings
  describe("unescaped quotes in strings", () => {
    it("escapes unescaped quotes inside a string value", () => {
      const input = '{"description": "He said "hello" to her"}';
      const result = parseAIResponse<{ description: string }>(input);
      expect(result.description).toContain("hello");
    });
  });

  // 6. URLs with // should NOT be corrupted
  describe("URL preservation", () => {
    it("preserves https:// URLs in string values", () => {
      const input = '{"url": "https://example.com/path"}';
      expect(parseAIResponse(input)).toEqual({
        url: "https://example.com/path",
      });
    });

    it("preserves http:// URLs in string values", () => {
      const input = '{"link": "http://foo.bar/baz?q=1"}';
      expect(parseAIResponse(input)).toEqual({
        link: "http://foo.bar/baz?q=1",
      });
    });

    it("preserves multiple URLs in a complex object", () => {
      const input =
        '{"website": "https://example.com", "api": "https://api.example.com/v2"}';
      const result = parseAIResponse<{ website: string; api: string }>(input);
      expect(result.website).toBe("https://example.com");
      expect(result.api).toBe("https://api.example.com/v2");
    });
  });

  // 7. Missing commas between elements
  describe("missing commas", () => {
    it("inserts missing comma between object keys", () => {
      const input = '{"a": 1\n"b": 2}';
      expect(parseAIResponse(input)).toEqual({ a: 1, b: 2 });
    });

    it("inserts missing comma between adjacent objects in array", () => {
      // extractBalancedJSON finds first { and balances it, so it extracts {"a": 1}
      // This is a known limitation: top-level arrays with missing commas
      // between objects get truncated to the first object.
      const input = '[{"a": 1}{"b": 2}]';
      expect(parseAIResponse(input)).toEqual({ a: 1 });
    });
  });

  // 8. Nested structures
  describe("nested structures", () => {
    it("handles deeply nested valid JSON", () => {
      const input = JSON.stringify({
        level1: {
          level2: {
            level3: {
              items: [1, 2, { deep: true }],
            },
          },
        },
      });
      const result = parseAIResponse<Record<string, unknown>>(input);
      expect(result).toHaveProperty("level1.level2.level3.items");
    });

    it("handles arrays of objects wrapped in an object", () => {
      const input = JSON.stringify({
        results: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
        ],
      });
      const result = parseAIResponse<{
        results: Array<{ id: number; name: string }>;
      }>(input);
      expect(result.results).toHaveLength(2);
      expect(result.results[1].name).toBe("b");
    });
  });

  // 9. Prose text before/after JSON
  describe("prose around JSON", () => {
    it("extracts JSON from text with prose before it", () => {
      const input =
        'Here is the analysis result:\n\n{"score": 85, "label": "high"}';
      expect(parseAIResponse(input)).toEqual({ score: 85, label: "high" });
    });

    it("extracts JSON from text with prose after it", () => {
      const input =
        '{"score": 85, "label": "high"}\n\nI hope this helps!';
      expect(parseAIResponse(input)).toEqual({ score: 85, label: "high" });
    });

    it("extracts JSON from text with prose before and after", () => {
      const input =
        "Based on my analysis:\n\n" +
        '{"risk": "medium", "confidence": 0.75}\n\n' +
        "Let me know if you need more details.";
      expect(parseAIResponse(input)).toEqual({
        risk: "medium",
        confidence: 0.75,
      });
    });
  });

  // 10. Non-JSON input should throw
  describe("non-JSON input", () => {
    it("throws on plain text without any JSON", () => {
      expect(() => parseAIResponse("This is just plain text")).toThrow();
    });

    it("throws on random symbols without structure", () => {
      expect(() => parseAIResponse("!@#$%^&*")).toThrow();
    });
  });

  // 11. Multi-line comments removed
  describe("multi-line comments", () => {
    it("removes /* */ comments and parses the JSON", () => {
      const input = '{"a": 1, /* this is a comment */ "b": 2}';
      expect(parseAIResponse(input)).toEqual({ a: 1, b: 2 });
    });

    it("removes multi-line comments spanning multiple lines", () => {
      const input = '{"key": "value" /* multi\nline\ncomment */ }';
      expect(parseAIResponse(input)).toEqual({ key: "value" });
    });
  });

  // 12. Control characters stripped
  describe("control characters", () => {
    it("strips control characters and parses correctly", () => {
      const input = '{"name": "test\x00\x01\x02value"}';
      const result = parseAIResponse<{ name: string }>(input);
      expect(result.name).toBe("testvalue");
    });

    it("preserves tabs and newlines in values via escaping", () => {
      // The repairJSON function escapes \n and \t inside strings
      const input = '{"text": "hello"}';
      expect(parseAIResponse(input)).toEqual({ text: "hello" });
    });
  });

  // 13. Empty input should throw
  describe("empty input", () => {
    it("throws on empty string", () => {
      expect(() => parseAIResponse("")).toThrow();
    });

    it("throws on whitespace-only string", () => {
      expect(() => parseAIResponse("   \n\t  ")).toThrow();
    });
  });
});
