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

function parseJSON<T>(text: string): T {
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

  const result = parseJSON<ExtractionResult>(text);
  return { result, tokensUsed, durationMs, provider };
}

// 2. Fraud Scoring
export async function analyzeFraud(
  claimData: Record<string, unknown>,
  claimId?: string
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
    maxTokens: 1024,
  });

  const result = parseJSON<FraudAnalysisResult>(text);
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

  const result = parseJSON<EstimationResult>(text);
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

  const result = parseJSON<LetterResult>(text);
  return { result, tokensUsed, durationMs, provider };
}
