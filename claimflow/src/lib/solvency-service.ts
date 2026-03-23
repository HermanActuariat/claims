import { prisma } from "@/lib/prisma";

const PROBABILITY_TABLE: Record<string, Record<string, number>> = {
  SUBMITTED:      { DEFAULT: 0.55 },
  UNDER_REVIEW:   { DEFAULT: 0.70 },
  INFO_REQUESTED: { DEFAULT: 0.65 },
  APPROVED:       { DEFAULT: 0.95 },
  REJECTED:       { DEFAULT: 0.02 },
  CLOSED:         { DEFAULT: 0.98 },
};

export function getProbabilityResolution(status: string, _claimType?: string): number {
  return PROBABILITY_TABLE[status]?.DEFAULT ?? 0.60;
}

export function computeBestEstimate(estimatedAmount: number | null, probability: number): number {
  if (!estimatedAmount || estimatedAmount <= 0) return 0;
  return Math.round(estimatedAmount * probability * 100) / 100;
}

export function computeSCR(bestEstimate: number): number {
  return Math.max(Math.round(bestEstimate * 0.15 * 100) / 100, 0);
}

export function computeRiskMargin(scr: number, riskFreeRate: number): number {
  if (riskFreeRate <= 0) return 0;
  return Math.round((0.06 * scr / riskFreeRate) * 100) / 100;
}

export async function computePortfolioProvisions(
  quarter: string,
  scope: "ALL" | "OPEN_ONLY",
  computedById: string
): Promise<{ report: Record<string, unknown>; claimCount: number; totalBE: number; totalSCR: number; totalRM: number }> {
  const where = scope === "OPEN_ONLY" ? { status: { not: "CLOSED" as const } } : {};
  const claims = await prisma.claim.findMany({
    where,
    select: { id: true, status: true, type: true, estimatedAmount: true },
  });

  const RISK_FREE_RATE = 0.035;
  let totalBE = 0, totalSCR = 0, totalRM = 0;

  // Invalider les provisions actives existantes pour ce trimestre
  await prisma.solvencyProvision.updateMany({
    where: { periodQuarter: quarter, status: "ACTIVE" },
    data: { status: "SUPERSEDED" },
  });

  const provisions: {
    claimId: string;
    periodQuarter: string;
    bestEstimate: number;
    riskFreeRate: number;
    scr: number;
    riskMargin: number;
    totalProvision: number;
    probabilityResolution: number;
    futureFlows: number;
    status: string;
    computedById: string | null;
  }[] = [];

  for (const claim of claims) {
    const prob = getProbabilityResolution(claim.status);
    const be = computeBestEstimate(claim.estimatedAmount, prob);
    const scr = computeSCR(be);
    const rm = computeRiskMargin(scr, RISK_FREE_RATE);
    const total = be + rm;

    totalBE += be;
    totalSCR += scr;
    totalRM += rm;

    provisions.push({
      claimId: claim.id,
      periodQuarter: quarter,
      bestEstimate: be,
      riskFreeRate: RISK_FREE_RATE,
      scr,
      riskMargin: rm,
      totalProvision: total,
      probabilityResolution: prob,
      futureFlows: be,
      status: "ACTIVE",
      computedById: computedById === "CRON" ? null : computedById,
    });
  }

  if (provisions.length > 0) {
    await prisma.solvencyProvision.createMany({ data: provisions });
  }

  const reportNumber = `SOLV-${quarter}`;
  const report = await prisma.solvencyReport.upsert({
    where: { reportNumber },
    create: {
      reportNumber,
      periodQuarter: quarter,
      totalBE: Math.round(totalBE * 100) / 100,
      totalSCR: Math.round(totalSCR * 100) / 100,
      totalRM: Math.round(totalRM * 100) / 100,
      totalProvisions: Math.round((totalBE + totalRM) * 100) / 100,
      claimCount: claims.length,
      generatedById: computedById === "CRON" ? null : computedById,
      snapshotJson: JSON.stringify({ quarter, scope, claimCount: claims.length, totalBE, totalSCR, totalRM }),
    },
    update: {
      totalBE: Math.round(totalBE * 100) / 100,
      totalSCR: Math.round(totalSCR * 100) / 100,
      totalRM: Math.round(totalRM * 100) / 100,
      totalProvisions: Math.round((totalBE + totalRM) * 100) / 100,
      claimCount: claims.length,
      generatedAt: new Date(),
      snapshotJson: JSON.stringify({ quarter, scope, claimCount: claims.length, totalBE, totalSCR, totalRM }),
    },
  });

  return { report: report as Record<string, unknown>, claimCount: claims.length, totalBE, totalSCR, totalRM };
}
