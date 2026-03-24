import {
  ExtractionResult,
  FraudAnalysisResult,
  EstimationResult,
  LetterResult,
  LetterType,
} from "@/types";
import {
  EXTRACTION_SYSTEM_PROMPT,
  extractionUserPrompt,
} from "@/lib/prompts/extraction";
import {
  FRAUD_SYSTEM_PROMPT,
  fraudUserPrompt,
} from "@/lib/prompts/fraud";
import {
  ESTIMATION_SYSTEM_PROMPT,
  estimationUserPrompt,
} from "@/lib/prompts/estimation";
import {
  LETTER_SYSTEM_PROMPT,
  letterUserPrompt,
} from "@/lib/prompts/letter";
import { getNetworkScoreForClaim } from "@/lib/fraud-network-service";
import { callWithFallback } from "@/lib/ai-provider";
import { parseAIResponse } from "@/lib/ai-utils";

// 1. Information Extraction
export async function extractClaimInfo(
  description: string,
  claimContext?: Record<string, unknown>
): Promise<{ result: ExtractionResult; tokensUsed: number; durationMs: number; provider?: string }> {
  const { text, tokensUsed, durationMs, provider } = await callWithFallback({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: extractionUserPrompt(description, claimContext),
    maxTokens: 2048,
  });

  const result = parseAIResponse<ExtractionResult>(text);
  return { result, tokensUsed, durationMs, provider };
}

// 2. Fraud Scoring
export async function analyzeFraud(
  claimData: Record<string, unknown>,
  claimId?: string,
  options?: { maxTokens?: number }
): Promise<{ result: FraudAnalysisResult; tokensUsed: number; durationMs: number; provider?: string }> {
  // Inject network risk context if claimId is provided
  const enrichedClaimData = { ...claimData };
  if (claimId) {
    try {
      const { networkScore, networkRisk } = await getNetworkScoreForClaim(claimId);
      enrichedClaimData.networkScore = networkScore;
      enrichedClaimData.networkRisk = networkRisk;
    } catch {
      // Non-blocking: if network score lookup fails, proceed without it
    }
  }

  const { text, tokensUsed, durationMs, provider } = await callWithFallback({
    systemPrompt: FRAUD_SYSTEM_PROMPT,
    userPrompt: fraudUserPrompt(enrichedClaimData),
    maxTokens: options?.maxTokens ?? 2048,
  });

  const result = parseAIResponse<FraudAnalysisResult>(text);
  return { result, tokensUsed, durationMs, provider };
}

// 3. Indemnization Estimation
export async function estimateIndemnization(
  claimData: Record<string, unknown>
): Promise<{ result: EstimationResult; tokensUsed: number; durationMs: number; provider?: string }> {
  const { text, tokensUsed, durationMs, provider } = await callWithFallback({
    systemPrompt: ESTIMATION_SYSTEM_PROMPT,
    userPrompt: estimationUserPrompt(claimData),
    maxTokens: 1024,
  });

  const result = parseAIResponse<EstimationResult>(text);
  return { result, tokensUsed, durationMs, provider };
}

// 4. Letter Generation
export async function generateLetter(
  claimData: Record<string, unknown>,
  letterType: LetterType
): Promise<{ result: LetterResult; tokensUsed: number; durationMs: number; provider?: string }> {
  const { text, tokensUsed, durationMs, provider } = await callWithFallback({
    systemPrompt: LETTER_SYSTEM_PROMPT(letterType),
    userPrompt: letterUserPrompt(claimData, letterType),
    maxTokens: 1024,
  });

  const result = parseAIResponse<LetterResult>(text);
  return { result, tokensUsed, durationMs, provider };
}
