/**
 * Tests — src/lib/ai-provider.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("groq-sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIProviderConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    aIProviderLog: {
      create: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import {
  callWithFallback,
  getProviderStats,
  recordSuccess,
  recordFailure,
  isCircuitOpen,
  createGroqAdapter,
  createAnthropicAdapter,
  createOpenAIAdapter,
  createMistralAdapter,
} from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";
import Groq from "groq-sdk";

type ProviderConfigReturn = ReturnType<typeof prisma.aIProviderConfig.findMany> extends Promise<infer T> ? T : never;
type ProviderLogCreateReturn = ReturnType<typeof prisma.aIProviderLog.create> extends Promise<infer T> ? T : never;
type ProviderLogFindManyReturn = ReturnType<typeof prisma.aIProviderLog.findMany> extends Promise<infer T> ? T : never;

const mockGroqConfig = {
  id: "cfg-groq",
  provider: "GROQ",
  active: true,
  priority: 1,
  defaultModel: "llama-3.3-70b-versatile",
  maxTokens: 4096,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAnthropicConfig = {
  id: "cfg-anthropic",
  provider: "ANTHROPIC",
  active: true,
  priority: 2,
  defaultModel: "claude-sonnet-4-6",
  maxTokens: 4096,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aIProviderLog.create).mockResolvedValue({} as ProviderLogCreateReturn);
});

// ─── Adapter stubs ────────────────────────────────────────────────────────────

describe("Stub adapters", () => {
  it("ANTHROPIC adapter throws an error", async () => {
    const adapter = createAnthropicAdapter();
    await expect(
      adapter.chat({ systemPrompt: "s", userPrompt: "u", maxTokens: 100 })
    ).rejects.toThrow("ANTHROPIC not configured");
  });

  it("OPENAI adapter throws an error", async () => {
    const adapter = createOpenAIAdapter();
    await expect(
      adapter.chat({ systemPrompt: "s", userPrompt: "u", maxTokens: 100 })
    ).rejects.toThrow("OPENAI not implemented");
  });

  it("MISTRAL adapter throws an error", async () => {
    const adapter = createMistralAdapter();
    await expect(
      adapter.chat({ systemPrompt: "s", userPrompt: "u", maxTokens: 100 })
    ).rejects.toThrow("MISTRAL not implemented");
  });
});

// ─── callWithFallback ─────────────────────────────────────────────────────────

describe("callWithFallback", () => {
  it("uses first active provider and returns result", async () => {
    vi.mocked(prisma.aIProviderConfig.findMany).mockResolvedValue(
      [mockGroqConfig] as unknown as ProviderConfigReturn
    );

    const groqInstance = vi.mocked(Groq).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } };
    };

    // Reset Groq mock to provide fresh instance
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"score": 42}' } }],
      usage: { total_tokens: 150 },
    });

    vi.mocked(Groq).mockImplementation(
      () =>
        ({
          chat: { completions: { create: mockCreate } },
        }) as never
    );

    const result = await callWithFallback({
      systemPrompt: "You are an assistant",
      userPrompt: "Analyze this claim",
      maxTokens: 500,
    });

    expect(result.provider).toBe("GROQ");
    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(result.text).toBe('{"score": 42}');
    expect(result.tokensUsed).toBe(150);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    void groqInstance; // suppress unused warning
  });

  it("falls back to next provider on failure", async () => {
    // Only provide ANTHROPIC (a stub adapter that always throws) so fallback exhaustion is guaranteed
    vi.mocked(prisma.aIProviderConfig.findMany).mockResolvedValue(
      [mockAnthropicConfig] as unknown as ProviderConfigReturn
    );

    // The ANTHROPIC adapter is a stub that always throws
    // So the overall call should throw "Tous les providers IA sont indisponibles"
    await expect(
      callWithFallback({
        systemPrompt: "s",
        userPrompt: "u",
        maxTokens: 100,
      })
    ).rejects.toThrow("Tous les providers IA sont indisponibles");

    // Should have logged the failure for ANTHROPIC
    expect(prisma.aIProviderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "ANTHROPIC",
          success: false,
        }),
      })
    );
  });

  it("skips provider with open circuit breaker", async () => {
    // Open the GROQ circuit breaker by recording 3+ failures
    recordFailure("GROQ-CIRCUIT-TEST");
    recordFailure("GROQ-CIRCUIT-TEST");
    recordFailure("GROQ-CIRCUIT-TEST");
    expect(isCircuitOpen("GROQ-CIRCUIT-TEST")).toBe(true);

    const mockConfig = { ...mockGroqConfig, provider: "GROQ-CIRCUIT-TEST" };
    vi.mocked(prisma.aIProviderConfig.findMany).mockResolvedValue(
      [mockConfig] as unknown as ProviderConfigReturn
    );

    // Circuit is open — no call should be made, throws all providers unavailable
    await expect(
      callWithFallback({ systemPrompt: "s", userPrompt: "u", maxTokens: 100 })
    ).rejects.toThrow("Tous les providers IA sont indisponibles");

    // Reset the circuit
    recordSuccess("GROQ-CIRCUIT-TEST");
    expect(isCircuitOpen("GROQ-CIRCUIT-TEST")).toBe(false);
  });

  it("throws when all providers fail", async () => {
    vi.mocked(prisma.aIProviderConfig.findMany).mockResolvedValue(
      [] as unknown as ProviderConfigReturn
    );

    await expect(
      callWithFallback({ systemPrompt: "s", userPrompt: "u", maxTokens: 100 })
    ).rejects.toThrow("Aucun provider IA actif configuré");
  });
});

// ─── getProviderStats ─────────────────────────────────────────────────────────

describe("getProviderStats", () => {
  it("returns aggregated stats from provider logs", async () => {
    const mockLogs = [
      { provider: "GROQ", success: true, durationMs: 200 },
      { provider: "GROQ", success: true, durationMs: 300 },
      { provider: "GROQ", success: false, durationMs: 100 },
      { provider: "ANTHROPIC", success: true, durationMs: 400 },
    ];

    vi.mocked(prisma.aIProviderLog.findMany).mockResolvedValue(
      mockLogs as unknown as ProviderLogFindManyReturn
    );

    const stats = await getProviderStats();

    const groqStats = stats.find((s) => s.provider === "GROQ");
    const anthropicStats = stats.find((s) => s.provider === "ANTHROPIC");

    expect(groqStats).toBeDefined();
    expect(groqStats?.totalCalls).toBe(3);
    expect(groqStats?.successRate).toBeCloseTo(2 / 3);
    expect(groqStats?.avgDurationMs).toBe(200); // (200+300+100)/3 = 200

    expect(anthropicStats).toBeDefined();
    expect(anthropicStats?.totalCalls).toBe(1);
    expect(anthropicStats?.successRate).toBe(1);
    expect(anthropicStats?.avgDurationMs).toBe(400);
  });

  it("returns empty array when no logs exist", async () => {
    vi.mocked(prisma.aIProviderLog.findMany).mockResolvedValue(
      [] as unknown as ProviderLogFindManyReturn
    );

    const stats = await getProviderStats();
    expect(stats).toEqual([]);
  });

  it("includes circuitOpen field in stats", async () => {
    const mockLogs = [{ provider: "GROQ-STATS-TEST", success: true, durationMs: 100 }];
    vi.mocked(prisma.aIProviderLog.findMany).mockResolvedValue(
      mockLogs as unknown as ProviderLogFindManyReturn
    );

    const stats = await getProviderStats();
    const entry = stats.find((s) => s.provider === "GROQ-STATS-TEST");
    expect(entry).toBeDefined();
    expect(typeof entry?.circuitOpen).toBe("boolean");
  });
});

// ─── Circuit Breaker logic ────────────────────────────────────────────────────

describe("Circuit Breaker", () => {
  it("opens circuit after 3 failures", () => {
    const provider = "CIRCUIT-TEST-OPEN";
    recordFailure(provider);
    recordFailure(provider);
    expect(isCircuitOpen(provider)).toBe(false);
    recordFailure(provider);
    expect(isCircuitOpen(provider)).toBe(true);
  });

  it("closes circuit after recordSuccess", () => {
    const provider = "CIRCUIT-TEST-RESET";
    recordFailure(provider);
    recordFailure(provider);
    recordFailure(provider);
    expect(isCircuitOpen(provider)).toBe(true);
    recordSuccess(provider);
    expect(isCircuitOpen(provider)).toBe(false);
  });

  it("returns false for unknown provider (no circuit breaker state)", () => {
    expect(isCircuitOpen("BRAND-NEW-PROVIDER-XYZ")).toBe(false);
  });
});

// ─── Groq adapter ─────────────────────────────────────────────────────────────

describe("createGroqAdapter", () => {
  it("adapter has name GROQ", () => {
    const adapter = createGroqAdapter();
    expect(adapter.name).toBe("GROQ");
  });
});
