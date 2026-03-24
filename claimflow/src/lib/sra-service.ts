/**
 * SRA Service — Barème de réparation & Devis garage
 * Business logic for repair reference estimation and garage quote extraction
 */

import { prisma } from "@/lib/prisma";
import { callWithFallback } from "@/lib/ai-provider";
import { parseAIResponse } from "@/lib/ai-utils";
import {
  RepairCategory,
  VehicleSegment,
  GarageQuoteLineItem,
  SRAEstimationResult,
} from "@/types";

// ─── Vehicle Segment Mapping ────────────────────────────────────────────────

const CITY_MODELS = ["clio", "twingo", "208", "c3", "fiesta", "polo", "yaris", "micra", "corsa", "ibiza", "fabia", "swift", "i10", "i20", "picanto", "rio", "up"];
const SUV_MODELS = ["x1", "x3", "x5", "x6", "x7", "q3", "q5", "q7", "q8", "gle", "glc", "gla", "glb", "tiguan", "touareg", "tucson", "sportage", "rav4", "cx-5", "3008", "5008", "kadjar", "captur", "duster", "ateca", "kodiaq", "karoq"];
const PREMIUM_BRANDS = ["mercedes", "bmw", "audi", "porsche", "jaguar", "lexus", "maserati", "bentley", "rolls-royce", "tesla", "volvo"];
const UTILITY_MODELS = ["kangoo", "berlingo", "partner", "caddy", "doblo", "transit", "trafic", "expert", "vito", "sprinter", "master", "boxer", "jumpy", "jumper"];

export function mapVehicleToSegment(make: string, model: string, _year: number): VehicleSegment {
  const lMake = make.toLowerCase();
  const lModel = model.toLowerCase();

  if (UTILITY_MODELS.some((m) => lModel.includes(m))) return "UTILITY";
  if (CITY_MODELS.some((m) => lModel.includes(m))) return "CITY";
  if (SUV_MODELS.some((m) => lModel.includes(m))) return "SUV";
  if (PREMIUM_BRANDS.some((b) => lMake.includes(b))) return "PREMIUM";
  return "SEDAN";
}

// ─── Safe JSON Parsing ──────────────────────────────────────────────────────

export function safeParseRegionFactor(refId: string, raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    console.warn(`[sra-service] regionFactor for ref ${refId} is not an object`);
    return null;
  } catch (err) {
    console.error(`[sra-service] Failed to parse regionFactor for ref ${refId}:`, err);
    return null;
  }
}

// ─── Region Coefficient ─────────────────────────────────────────────────────

export function getRegionCoefficient(
  regionFactor: Record<string, number> | null,
  department: string
): number {
  if (!regionFactor) return 1.0;
  return regionFactor[department] ?? regionFactor["default"] ?? 1.0;
}

// ─── Repair References Query ────────────────────────────────────────────────

export async function getRepairReferences(
  category?: RepairCategory,
  vehicleSegment?: VehicleSegment
) {
  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (vehicleSegment) where.vehicleSegment = vehicleSegment;

  return prisma.repairReference.findMany({
    where,
    orderBy: [{ category: "asc" }, { vehicleSegment: "asc" }],
  });
}

// ─── Barème Estimation ──────────────────────────────────────────────────────

export async function computeBaremeEstimation(
  claimId: string,
  department?: string
): Promise<SRAEstimationResult> {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      policyholder: true,
      garageQuotes: {
        include: { lines: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!claim) throw new Error("Sinistre introuvable");

  const { policyholder } = claim;
  const segment = mapVehicleToSegment(
    policyholder.vehicleMake,
    policyholder.vehicleModel,
    policyholder.vehicleYear
  );

  // Query matching repair references
  const refs = await prisma.repairReference.findMany({
    where: {
      vehicleSegment: segment,
      validFrom: { lte: new Date() },
      OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
    },
  });

  // Compute barème estimate
  let baremeTotal = 0;
  const breakdown: Record<string, number> = {};

  for (const ref of refs) {
    const regionCoeff = department
      ? getRegionCoefficient(
          safeParseRegionFactor(ref.id, ref.regionFactor),
          department
        )
      : 1.0;

    const lineCost = (ref.avgPartCost + ref.avgLaborHours * ref.avgLaborRate) * regionCoeff;
    baremeTotal += lineCost;
    breakdown[ref.category] = (breakdown[ref.category] ?? 0) + lineCost;
  }

  // Check for validated garage quotes
  const validatedQuote = claim.garageQuotes.find((q) => q.validatedById !== null);
  const garageQuoteTotal = validatedQuote?.totalAmount ?? null;
  const garageName = validatedQuote?.garageName ?? null;

  let source: SRAEstimationResult["source"] = "BAREME_INTERNE";
  if (garageQuoteTotal !== null && baremeTotal > 0) source = "COMBINED";
  else if (garageQuoteTotal !== null) source = "DEVIS_GARAGE";

  return {
    source,
    baremeEstimate: refs.length > 0
      ? { total: Math.round(baremeTotal * 100) / 100, breakdown: breakdown as Record<RepairCategory, number> }
      : null,
    garageQuoteTotal,
    garageName,
    regionCoefficient: department
      ? getRegionCoefficient(
          safeParseRegionFactor(refs[0]?.id ?? "unknown", refs[0]?.regionFactor ?? null),
          department
        )
      : 1.0,
    department: department ?? null,
  };
}

// ─── Claim Estimation Context ───────────────────────────────────────────────

export async function getClaimEstimationContext(
  claimId: string,
  department?: string
): Promise<{ baremeData?: string; garageQuoteData?: string }> {
  const sra = await computeBaremeEstimation(claimId, department);
  const context: { baremeData?: string; garageQuoteData?: string } = {};

  if (sra.baremeEstimate) {
    context.baremeData = JSON.stringify({
      source: "Barème SRA interne",
      vehicleSegment: "auto-detected",
      regionCoefficient: sra.regionCoefficient,
      department: sra.department,
      totalEstimate: sra.baremeEstimate.total,
      breakdown: sra.baremeEstimate.breakdown,
    }, null, 2);
  }

  if (sra.garageQuoteTotal !== null) {
    const quotes = await prisma.garageQuote.findMany({
      where: { claimId, validatedById: { not: null } },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (quotes.length > 0) {
      const quote = quotes[0];
      context.garageQuoteData = JSON.stringify({
        garageName: quote.garageName,
        garageCity: quote.garageCity,
        totalAmount: quote.totalAmount,
        lines: quote.lines.map((l) => ({
          type: l.lineType,
          description: l.description,
          quantity: l.quantity,
          unitPriceHT: l.unitPriceHT,
          totalHT: l.totalHT,
        })),
      }, null, 2);
    }
  }

  return context;
}

// ─── Garage Quote AI Extraction ─────────────────────────────────────────────

const GARAGE_QUOTE_EXTRACTION_PROMPT = `Tu es un expert en extraction de données de devis de réparation automobile.

## Mission
Extraire les lignes d'un devis garage à partir du texte du document.

## Format de sortie
Réponds UNIQUEMENT en JSON valide — un tableau de lignes :
\`\`\`json
[
  {
    "lineType": "PART | LABOR | PAINT | CONSUMABLE | OTHER",
    "description": "description de la ligne",
    "partReference": "référence pièce ou null",
    "quantity": 1,
    "unitPriceHT": 0.0,
    "laborHours": null,
    "laborRateHT": null,
    "totalHT": 0.0,
    "confidence": 0.9
  }
]
\`\`\`

## Règles
- Identifier chaque ligne du devis (pièces, main d'oeuvre, peinture, consommables)
- Attribuer un score de confiance (0.0-1.0) à chaque ligne
- Si une information manque, mettre null
- Le totalHT doit être calculé comme quantity * unitPriceHT
- Pour la main d'oeuvre, utiliser laborHours * laborRateHT comme totalHT`;

export async function extractGarageQuoteLines(
  documentText: string
): Promise<{ result: GarageQuoteLineItem[]; tokensUsed: number; durationMs: number; provider?: string }> {
  const { text, tokensUsed, durationMs, provider } = await callWithFallback({
    systemPrompt: GARAGE_QUOTE_EXTRACTION_PROMPT,
    userPrompt: `Voici le contenu du devis garage à analyser :\n\n${documentText}`,
    maxTokens: 2048,
  });

  const result = parseAIResponse<GarageQuoteLineItem[]>(text);
  return { result: Array.isArray(result) ? result : [], tokensUsed, durationMs, provider };
}
