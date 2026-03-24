/**
 * Tests — src/lib/ai-service.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCallWithFallback,
  mockParseAIResponse,
  mockGetNetworkScoreForClaim,
} = vi.hoisted(() => ({
  mockCallWithFallback: vi.fn(),
  mockParseAIResponse: vi.fn(),
  mockGetNetworkScoreForClaim: vi.fn(),
}));

vi.mock("@/lib/ai-provider", () => ({
  callWithFallback: mockCallWithFallback,
}));

vi.mock("@/lib/ai-utils", () => ({
  parseAIResponse: mockParseAIResponse,
}));

vi.mock("@/lib/fraud-network-service", () => ({
  getNetworkScoreForClaim: mockGetNetworkScoreForClaim,
}));

vi.mock("@/lib/prompts/extraction", () => ({
  EXTRACTION_SYSTEM_PROMPT: "extraction-system-prompt",
  extractionUserPrompt: vi.fn(
    (desc: string, ctx?: Record<string, unknown>) =>
      `extract:${desc}:${JSON.stringify(ctx ?? {})}`
  ),
}));

vi.mock("@/lib/prompts/fraud", () => ({
  FRAUD_SYSTEM_PROMPT: "fraud-system-prompt",
  fraudUserPrompt: vi.fn(
    (data: Record<string, unknown>) => `fraud:${JSON.stringify(data)}`
  ),
}));

vi.mock("@/lib/prompts/estimation", () => ({
  ESTIMATION_SYSTEM_PROMPT: "estimation-system-prompt",
  estimationUserPrompt: vi.fn(
    (data: Record<string, unknown>) => `estimation:${JSON.stringify(data)}`
  ),
}));

vi.mock("@/lib/prompts/letter", () => ({
  LETTER_SYSTEM_PROMPT: vi.fn((type: string) => `letter-system-prompt:${type}`),
  letterUserPrompt: vi.fn(
    (data: Record<string, unknown>, type: string) =>
      `letter:${type}:${JSON.stringify(data)}`
  ),
}));

import {
  extractClaimInfo,
  analyzeFraud,
  estimateIndemnization,
  generateLetter,
} from "@/lib/ai-service";

const defaultAIResponse = {
  text: '{"score":42}',
  tokensUsed: 100,
  durationMs: 500,
  provider: "GROQ",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCallWithFallback.mockResolvedValue(defaultAIResponse);
  mockParseAIResponse.mockReturnValue({ score: 42 });
});

// ─── extractClaimInfo ─────────────────────────────────────────────────────────

describe("extractClaimInfo", () => {
  it("calls callWithFallback with correct prompts and returns parsed result", async () => {
    const result = await extractClaimInfo("accident sur autoroute", {
      policyId: "POL-001",
    });

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    expect(mockCallWithFallback).toHaveBeenCalledWith({
      systemPrompt: "extraction-system-prompt",
      userPrompt: expect.stringContaining("accident sur autoroute"),
      maxTokens: 2048,
    });

    expect(mockParseAIResponse).toHaveBeenCalledWith('{"score":42}');

    expect(result).toEqual({
      result: { score: 42 },
      tokensUsed: 100,
      durationMs: 500,
      provider: "GROQ",
    });
  });

  it("works without claimContext", async () => {
    const result = await extractClaimInfo("collision");

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    expect(result.result).toEqual({ score: 42 });
  });
});

// ─── analyzeFraud ─────────────────────────────────────────────────────────────

describe("analyzeFraud", () => {
  it("returns parsed fraud result", async () => {
    const fraudResult = { score: 75, indicators: ["suspicious"] };
    mockParseAIResponse.mockReturnValue(fraudResult);

    const result = await analyzeFraud({ vehicleType: "sedan" });

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    expect(mockCallWithFallback).toHaveBeenCalledWith({
      systemPrompt: "fraud-system-prompt",
      userPrompt: expect.stringContaining("sedan"),
      maxTokens: 2048,
    });

    expect(result.result).toEqual(fraudResult);
    expect(result.provider).toBe("GROQ");
  });

  it("enriches claim data with network score when claimId is provided", async () => {
    mockGetNetworkScoreForClaim.mockResolvedValue({
      networkScore: 0.8,
      networkRisk: "HIGH",
    });

    await analyzeFraud({ vehicleType: "sedan" }, "CLM-2026-00001");

    expect(mockGetNetworkScoreForClaim).toHaveBeenCalledWith("CLM-2026-00001");

    // The user prompt should include the enriched data with networkScore
    const callArgs = mockCallWithFallback.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain("0.8");
    expect(callArgs.userPrompt).toContain("HIGH");
  });

  it("silently continues when network score lookup fails", async () => {
    mockGetNetworkScoreForClaim.mockRejectedValue(
      new Error("Network service unavailable")
    );

    const result = await analyzeFraud({ vehicleType: "sedan" }, "CLM-2026-00001");

    expect(mockGetNetworkScoreForClaim).toHaveBeenCalledWith("CLM-2026-00001");
    // Should still return a valid result despite the network score failure
    expect(result.result).toEqual({ score: 42 });
    expect(result.tokensUsed).toBe(100);
  });

  it("does not call getNetworkScoreForClaim when claimId is not provided", async () => {
    await analyzeFraud({ vehicleType: "sedan" });

    expect(mockGetNetworkScoreForClaim).not.toHaveBeenCalled();
  });

  it("respects custom maxTokens option", async () => {
    await analyzeFraud({ vehicleType: "sedan" }, undefined, {
      maxTokens: 4096,
    });

    expect(mockCallWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 4096 })
    );
  });
});

// ─── estimateIndemnization ────────────────────────────────────────────────────

describe("estimateIndemnization", () => {
  it("returns parsed estimation result", async () => {
    const estimationResult = { totalAmount: 5000, breakdown: [] };
    mockParseAIResponse.mockReturnValue(estimationResult);

    const result = await estimateIndemnization({ damageType: "collision" });

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    expect(mockCallWithFallback).toHaveBeenCalledWith({
      systemPrompt: "estimation-system-prompt",
      userPrompt: expect.stringContaining("collision"),
      maxTokens: 1024,
    });

    expect(result).toEqual({
      result: estimationResult,
      tokensUsed: 100,
      durationMs: 500,
      provider: "GROQ",
    });
  });
});

// ─── generateLetter ───────────────────────────────────────────────────────────

describe("generateLetter", () => {
  it("returns parsed letter result", async () => {
    const letterResult = { subject: "Acknowledgment", body: "Dear..." };
    mockParseAIResponse.mockReturnValue(letterResult);

    const result = await generateLetter(
      { claimNumber: "CLM-2026-00001" },
      "ACKNOWLEDGMENT"
    );

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    expect(mockCallWithFallback).toHaveBeenCalledWith({
      systemPrompt: "letter-system-prompt:ACKNOWLEDGMENT",
      userPrompt: expect.stringContaining("CLM-2026-00001"),
      maxTokens: 1024,
    });

    expect(result).toEqual({
      result: letterResult,
      tokensUsed: 100,
      durationMs: 500,
      provider: "GROQ",
    });
  });
});
