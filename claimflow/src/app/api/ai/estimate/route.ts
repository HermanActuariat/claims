import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AIEstimateSchema } from "@/lib/validations";
import { estimateIndemnizationWithSRA } from "@/lib/ai-service";
import { createAuditLog } from "@/lib/audit";
import { checkAutoApproval } from "@/lib/claim-service";
import { getRepairReferences, getRegionalCoefficient, CLAIM_TYPE_TO_REPAIR_CATEGORY } from "@/lib/sra-service";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = AIEstimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const claim = await prisma.claim.findUnique({
      where: { id: parsed.data.claimId },
      include: { policyholder: true },
    });
    if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

    const estimateData = {
      type: claim.type,
      description: claim.description,
      vehicleMake: claim.policyholder.vehicleMake,
      vehicleModel: claim.policyholder.vehicleModel,
      vehicleYear: claim.policyholder.vehicleYear,
      coverageType: claim.policyholder.coverageType,
    };

    // Enrich with SRA bareme + garage quotes
    const category = CLAIM_TYPE_TO_REPAIR_CATEGORY[claim.type] || "OTHER";
    const baremeEntries = await getRepairReferences(category);
    const garageQuotes = await prisma.garageQuote.findMany({
      where: { claimId: claim.id, validatedAt: { not: null } },
      include: { lines: true },
    });
    const department = claim.incidentZipCode?.substring(0, 2);
    const regionalCoef = baremeEntries.length > 0
      ? getRegionalCoefficient(baremeEntries[0].regionFactor, department ?? undefined)
      : 1.0;

    const sraContext = {
      baremeEntries: baremeEntries.length > 0 ? baremeEntries : undefined,
      garageQuote: garageQuotes.length > 0 ? garageQuotes[0] : undefined,
      regionalCoef,
    };

    const { result, tokensUsed, durationMs } = await estimateIndemnizationWithSRA(estimateData, sraContext);

    const analysis = await prisma.aIAnalysis.create({
      data: {
        type: "ESTIMATION",
        inputData: JSON.stringify(estimateData),
        outputData: JSON.stringify(result),
        tokensUsed,
        durationMs,
        claimId: claim.id,
      },
    });

    await prisma.claim.update({
      where: { id: claim.id },
      data: { estimatedAmount: result.estimatedTotal },
    });

    if (claim.fraudScore !== null) {
      await checkAutoApproval(claim.id, result.estimatedTotal, claim.fraudScore, session.user.id);
    }

    await createAuditLog({
      action: "AI_ANALYSIS_RUN",
      entityType: "CLAIM",
      entityId: claim.id,
      after: { type: "ESTIMATION", estimatedTotal: result.estimatedTotal },
      claimId: claim.id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: { analysis, result } }, { status: 201 });
  } catch (err) {
    console.error("[AI/estimate]", err);
    return NextResponse.json({ error: "Erreur estimation" }, { status: 500 });
  }
}
