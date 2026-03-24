import { prisma } from "@/lib/prisma";
import { callWithFallback } from "@/lib/ai-provider";
import { parseAIResponse } from "@/lib/ai-utils";
import { SRAEstimationResult } from "@/types";

// ─── Quote Extraction Prompt ────────────────────────────────────────────────

const QUOTE_EXTRACTION_SYSTEM_PROMPT = `Tu es un expert en extraction de donnees de devis automobile.
Extrais les lignes du devis garage en JSON structure.

Format de sortie STRICT — JSON uniquement :
{
  "garageName": "string | null",
  "garageCity": "string | null",
  "totalAmount": number | null,
  "lines": [
    {
      "lineType": "PART | LABOR | PAINT | CONSUMABLE | OTHER",
      "description": "string",
      "partReference": "string | null",
      "quantity": 1,
      "unitPriceHT": 0.0,
      "laborHours": null,
      "laborRateHT": null,
      "totalHT": 0.0,
      "confidence": 0.0
    }
  ]
}

Regles :
- confidence entre 0.0 et 1.0 (certitude de l'extraction)
- Si un champ est illisible ou absent, mettre null et confidence basse
- totalHT = quantity * unitPriceHT (ou laborHours * laborRateHT pour LABOR)
- Repondre UNIQUEMENT en JSON valide, sans texte supplementaire`;

// ─── Constants ──────────────────────────────────────────────────────────────

export const CLAIM_TYPE_TO_REPAIR_CATEGORY: Record<string, string> = {
  COLLISION: "BODY",
  GLASS: "GLASS",
  FIRE: "OTHER",
  VANDALISM: "BODY",
  THEFT: "OTHER",
  OTHER: "OTHER",
  NATURAL_DISASTER: "OTHER",
  BODILY_INJURY: "OTHER",
};

// ─── Public Functions ───────────────────────────────────────────────────────

export async function getRepairReferences(
  category: string,
  vehicleSegment?: string
) {
  const now = new Date();
  return prisma.repairReference.findMany({
    where: {
      category,
      ...(vehicleSegment ? { vehicleSegment } : {}),
      validFrom: { lte: now },
      OR: [
        { validUntil: null },
        { validUntil: { gte: now } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getRegionalCoefficient(
  regionFactor: string | null,
  department?: string
): number {
  if (!regionFactor) return 1.0;

  try {
    const factors: Record<string, number> = JSON.parse(regionFactor);
    if (department && factors[department] !== undefined) {
      return factors[department];
    }
    return factors["default"] ?? 1.0;
  } catch (err) {
    console.warn(`[sra-service] Failed to parse regionFactor: ${regionFactor}`, err);
    return 1.0;
  }
}

export async function extractGarageQuoteLines(
  documentContent: string
): Promise<{
  garageName: string | null;
  garageCity: string | null;
  totalAmount: number | null;
  lines: {
    lineType: string;
    description: string;
    partReference: string | null;
    quantity: number;
    unitPriceHT: number;
    laborHours: number | null;
    laborRateHT: number | null;
    totalHT: number;
    confidence: number | null;
  }[];
}> {
  const { text } = await callWithFallback({
    systemPrompt: QUOTE_EXTRACTION_SYSTEM_PROMPT,
    userPrompt: `Voici le contenu du devis garage a extraire :\n\n${documentContent}`,
    maxTokens: 2048,
  });

  const result = parseAIResponse<{
    garageName: string | null;
    garageCity: string | null;
    totalAmount: number | null;
    lines: {
      lineType: string;
      description: string;
      partReference: string | null;
      quantity: number;
      unitPriceHT: number;
      laborHours: number | null;
      laborRateHT: number | null;
      totalHT: number;
      confidence: number | null;
    }[];
  }>(text);

  return {
    garageName: result.garageName ?? null,
    garageCity: result.garageCity ?? null,
    totalAmount: result.totalAmount ?? null,
    lines: result.lines ?? [],
  };
}

export async function computeSRAEstimation(
  claimId: string,
  department?: string
): Promise<SRAEstimationResult> {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { policyholder: true },
  });

  if (!claim) throw new Error("Sinistre introuvable");

  // Map claim type to repair category
  const category = CLAIM_TYPE_TO_REPAIR_CATEGORY[claim.type] || "OTHER";

  // Lookup bareme entries
  const baremeEntries = await getRepairReferences(category);

  // Find validated garage quotes
  const garageQuotes = await prisma.garageQuote.findMany({
    where: { claimId, validatedAt: { not: null } },
    include: { lines: true },
  });

  // Get regional coefficient
  const dept = department || claim.incidentZipCode?.substring(0, 2);
  const regionalCoef = baremeEntries.length > 0
    ? getRegionalCoefficient(baremeEntries[0].regionFactor, dept)
    : 1.0;

  // Compute estimation
  let parts = 0;
  let labor = 0;
  let paint = 0;
  let other = 0;
  let source: "BAREME_INTERNE" | "DEVIS_GARAGE" | "MIXTE" = "BAREME_INTERNE";
  let confidence: "low" | "medium" | "high" = "low";

  if (garageQuotes.length > 0) {
    // Use real garage quote data
    const quote = garageQuotes[0];
    for (const line of quote.lines) {
      switch (line.lineType) {
        case "PART":
          parts += line.totalHT;
          break;
        case "LABOR":
          labor += line.totalHT;
          break;
        case "PAINT":
          paint += line.totalHT;
          break;
        default:
          other += line.totalHT;
          break;
      }
    }
    source = baremeEntries.length > 0 ? "MIXTE" : "DEVIS_GARAGE";
    confidence = "high";
  } else if (baremeEntries.length > 0) {
    // Use bareme interne
    for (const entry of baremeEntries) {
      parts += entry.avgPartCost;
      labor += entry.avgLaborHours * entry.avgLaborRate;
    }
    // Average over entries if multiple
    if (baremeEntries.length > 1) {
      parts /= baremeEntries.length;
      labor /= baremeEntries.length;
    }
    source = "BAREME_INTERNE";
    confidence = "medium";
  }

  // Apply regional coefficient
  parts *= regionalCoef;
  labor *= regionalCoef;
  paint *= regionalCoef;
  other *= regionalCoef;

  const estimatedTotal = parts + labor + paint + other;
  const franchise = 300; // Default franchise
  const netEstimate = Math.max(0, estimatedTotal - franchise);
  const margin = estimatedTotal * 0.15;

  return {
    estimatedTotal: Math.round(estimatedTotal * 100) / 100,
    min: Math.round((estimatedTotal - margin) * 100) / 100,
    max: Math.round((estimatedTotal + margin) * 100) / 100,
    breakdown: {
      parts: Math.round(parts * 100) / 100,
      labor: Math.round(labor * 100) / 100,
      paint: Math.round(paint * 100) / 100,
      other: Math.round(other * 100) / 100,
    },
    franchise,
    netEstimate: Math.round(netEstimate * 100) / 100,
    confidence,
    source,
    regionalCoefficient: regionalCoef,
    methodology: source === "DEVIS_GARAGE"
      ? "Estimation basee sur le devis garage reel valide"
      : source === "MIXTE"
        ? "Estimation croisee bareme SRA interne et devis garage reel"
        : "Estimation basee sur le bareme SRA interne avec coefficient regional",
  };
}
