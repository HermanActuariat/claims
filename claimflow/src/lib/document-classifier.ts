/**
 * Service de classification de documents d'assurance
 * Heuristique d'abord, fallback IA via Groq si non déterminable
 */

import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { DocumentType, ClassificationResult } from "@/types";
import {
  CLASSIFY_DOCUMENT_SYSTEM_PROMPT,
  classifyDocumentUserPrompt,
} from "@/lib/prompts/classify-document";

let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

const MODEL = "llama-3.3-70b-versatile";

function parseJSON<T>(text: string): T {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return JSON.parse(codeBlock[1].trim()) as T;

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
  }

  throw new Error(`Réponse IA non parseable : ${text.slice(0, 200)}`);
}

function getText(response: Groq.Chat.ChatCompletion): string {
  return response.choices[0]?.message?.content ?? "{}";
}

// ─── Heuristic Classification ─────────────────────────────────────────────────

/**
 * Tente de classifier un document par heuristique (nom de fichier + MIME).
 * Retourne null si la classification est incertaine.
 */
export function classifyByHeuristic(
  filename: string,
  mimeType: string
): DocumentType | null {
  const lower = filename.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  // E-constat : format XML ou JSON avec mot-clé constat/econstat
  if (
    (ext === "xml" || ext === "json") &&
    (lower.includes("econstat") ||
      lower.includes("e-constat") ||
      lower.includes("constat"))
  ) {
    return "ECONSTAT";
  }

  // Factures / devis
  if (
    lower.includes("facture") ||
    lower.includes("invoice") ||
    lower.includes("devis") ||
    lower.includes("quote") ||
    lower.includes("repair")
  ) {
    return "INVOICE";
  }

  // Photos (images sans autre mot-clé identifiant)
  if (
    mimeType.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic"].includes(ext)
  ) {
    // Affine si le nom donne un indice plus précis
    if (lower.includes("facture") || lower.includes("invoice")) return "INVOICE";
    if (lower.includes("carte") || lower.includes("card")) return "INSURANCE_CARD";
    if (lower.includes("permis") || lower.includes("cni") || lower.includes("passport")) return "ID_CARD";
    if (lower.includes("rapport") || lower.includes("expert")) return "EXPERT_REPORT";
    if (lower.includes("pv") || lower.includes("police") || lower.includes("gendarmerie")) return "POLICE_REPORT";
    return "PHOTO";
  }

  // Rapport de police / gendarmerie
  if (
    lower.includes("pv") ||
    lower.includes("proces-verbal") ||
    lower.includes("proces_verbal") ||
    lower.includes("police_report") ||
    lower.includes("plainte") ||
    lower.includes("gendarmerie")
  ) {
    return "POLICE_REPORT";
  }

  // Rapport d'expertise
  if (
    lower.includes("expertise") ||
    lower.includes("expert") ||
    lower.includes("rapport_technique") ||
    lower.includes("technical_report")
  ) {
    return "EXPERT_REPORT";
  }

  // Carte d'identité / permis
  if (
    lower.includes("cni") ||
    lower.includes("carte_identite") ||
    lower.includes("carte-identite") ||
    lower.includes("passeport") ||
    lower.includes("passport") ||
    lower.includes("permis_conduire") ||
    lower.includes("driving_license")
  ) {
    return "ID_CARD";
  }

  // Carte verte / attestation d'assurance
  if (
    lower.includes("carte_verte") ||
    lower.includes("carte-verte") ||
    lower.includes("attestation_assurance") ||
    lower.includes("insurance_card") ||
    lower.includes("green_card")
  ) {
    return "INSURANCE_CARD";
  }

  // PDF générique — incertain
  if (ext === "pdf" || mimeType === "application/pdf") {
    return null;
  }

  return null;
}

// ─── AI Classification ────────────────────────────────────────────────────────

async function classifyWithAI(
  filename: string,
  mimeType: string,
  textContent?: string
): Promise<ClassificationResult> {
  const userPrompt = classifyDocumentUserPrompt(filename, mimeType, textContent);

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      { role: "system", content: CLASSIFY_DOCUMENT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = parseJSON<{
    documentType: string;
    confidence: number;
    reasoning: string;
  }>(getText(response));

  // Validate documentType is one of the known values
  const validTypes: DocumentType[] = [
    "ECONSTAT",
    "INVOICE",
    "PHOTO",
    "POLICE_REPORT",
    "EXPERT_REPORT",
    "ID_CARD",
    "INSURANCE_CARD",
    "OTHER",
  ];

  const documentType: DocumentType = validTypes.includes(raw.documentType as DocumentType)
    ? (raw.documentType as DocumentType)
    : "OTHER";

  return {
    documentType,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    reasoning: raw.reasoning ?? "Classification par IA",
  };
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classifie un document par heuristique, avec fallback IA.
 * Met à jour le champ documentType dans la base de données.
 */
export async function classifyDocument(
  documentId: string
): Promise<ClassificationResult> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document introuvable : ${documentId}`);
  }

  // 1. Heuristic first
  const heuristicType = classifyByHeuristic(document.filename, document.mimeType);

  let result: ClassificationResult;

  if (heuristicType !== null) {
    result = {
      documentType: heuristicType,
      confidence: 0.9,
      reasoning: "Classification par heuristique (nom de fichier / type MIME)",
    };
  } else {
    // 2. AI fallback
    // Try to provide OCR text if available
    let ocrText: string | undefined;
    if (document.ocrExtracted && document.ocrData) {
      try {
        const ocrParsed = JSON.parse(document.ocrData) as { text?: string };
        ocrText = ocrParsed.text;
      } catch {
        // Non-blocking
      }
    }
    result = await classifyWithAI(document.filename, document.mimeType, ocrText);
  }

  // Persist classification
  await prisma.document.update({
    where: { id: documentId },
    data: {
      documentType: result.documentType,
    },
  });

  return result;
}
