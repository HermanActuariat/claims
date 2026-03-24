/**
 * Service OCR — Extraction de texte depuis image de document
 * Utilise Groq (llama-3.3-70b-versatile) avec les prompts OCR
 */

import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { OcrResult } from "@/types";
import { OCR_SYSTEM_PROMPT, ocrTextUserPrompt } from "@/lib/prompts/ocr";
import { parseAIResponse } from "@/lib/ai-utils";

let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

const MODEL = "llama-3.3-70b-versatile";

function getText(response: Groq.Chat.ChatCompletion): string {
  const content = response.choices[0]?.message?.content;
  if (!content || content.trim() === "") {
    throw new Error("AI returned empty response — possible rate limit or content filter");
  }
  return content;
}

/**
 * Extrait le texte et les champs structurés d'un document image via IA.
 * Met à jour le document en base avec le résultat OCR.
 */
export async function extractTextFromImage(documentId: string): Promise<{
  result: OcrResult;
  tokensUsed: number;
  durationMs: number;
}> {
  // Fetch document from DB
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document introuvable : ${documentId}`);
  }

  const start = Date.now();

  // Build user prompt using document metadata
  const userPrompt = ocrTextUserPrompt(document.url, document.filename);

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: OCR_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const durationMs = Date.now() - start;
  const tokensUsed = response.usage?.total_tokens ?? 0;
  const result = parseAIResponse<OcrResult>(getText(response));

  // Ensure result has required shape with defaults
  const ocrResult: OcrResult = {
    text: result.text ?? "",
    fields: result.fields ?? {},
    confidence: typeof result.confidence === "number" ? result.confidence : 0,
    language: result.language ?? "fr",
  };

  // Persist OCR result to document record
  await prisma.document.update({
    where: { id: documentId },
    data: {
      ocrExtracted: true,
      ocrData: JSON.stringify(ocrResult),
      ocrConfidence: ocrResult.confidence,
    },
  });

  return { result: ocrResult, tokensUsed, durationMs };
}
