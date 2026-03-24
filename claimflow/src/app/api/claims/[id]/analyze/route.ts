import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { extractClaimInfo, analyzeFraud, estimateIndemnization } from "@/lib/ai-service";
import { checkAutoApproval, checkFraudEscalation } from "@/lib/claim-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      policyholder: true,
      documents: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const results: Record<string, unknown> = {};

  // 1. Extract information from description
  try {
    const { result: extraction, tokensUsed, durationMs } = await extractClaimInfo(
      claim.description,
      {
        type: claim.type,
        incidentDate: claim.incidentDate,
        incidentLocation: claim.incidentLocation,
        thirdPartyInvolved: claim.thirdPartyInvolved,
      }
    );

    await prisma.aIAnalysis.create({
      data: {
        type: "EXTRACTION",
        inputData: JSON.stringify({ description: claim.description }),
        outputData: JSON.stringify(extraction),
        tokensUsed,
        durationMs,
        claimId: id,
      },
    });

    results.extraction = extraction;
  } catch (err) {
    results.extractionError = (err as Error).message;
  }

  // 2. Analyze fraud risk
  try {
    const claimData = {
      type: claim.type,
      description: claim.description,
      incidentDate: claim.incidentDate,
      declarationDate: claim.createdAt,
      estimatedAmount: claim.estimatedAmount,
      thirdPartyInvolved: claim.thirdPartyInvolved,
      vehicleYear: claim.policyholder.vehicleYear,
      contractStart: claim.policyholder.contractStart,
      incidentLocation: claim.incidentLocation,
      documentCount: claim.documents.length,
    };

    let fraudResult: { result: Awaited<ReturnType<typeof analyzeFraud>>["result"]; tokensUsed: number; durationMs: number };
    try {
      fraudResult = await analyzeFraud(claimData);
    } catch {
      // Retry once with reduced maxTokens to get shorter, more parseable output
      fraudResult = await analyzeFraud(claimData, undefined, { maxTokens: 1024 });
    }
    const { result: fraud, tokensUsed, durationMs } = fraudResult;

    await prisma.aIAnalysis.create({
      data: {
        type: "FRAUD_SCORING",
        inputData: JSON.stringify(claimData),
        outputData: JSON.stringify(fraud),
        tokensUsed,
        durationMs,
        claimId: id,
      },
    });

    // Update claim with fraud score
    await prisma.claim.update({
      where: { id },
      data: {
        fraudScore: fraud.score,
        fraudRisk: fraud.risk,
      },
    });

    results.fraud = fraud;

    // Check for auto-escalation
    if (claim.estimatedAmount) {
      await checkFraudEscalation(id, fraud.score, session.user.id);
    }
  } catch (err) {
    results.fraudError = (err as Error).message;
  }

  // 3. Estimate indemnization
  try {
    const estimateData = {
      type: claim.type,
      description: claim.description,
      vehicleMake: claim.policyholder.vehicleMake,
      vehicleModel: claim.policyholder.vehicleModel,
      vehicleYear: claim.policyholder.vehicleYear,
      coverageType: claim.policyholder.coverageType,
      extraction: results.extraction,
    };

    const { result: estimation, tokensUsed, durationMs } = await estimateIndemnization(estimateData);

    await prisma.aIAnalysis.create({
      data: {
        type: "ESTIMATION",
        inputData: JSON.stringify(estimateData),
        outputData: JSON.stringify(estimation),
        tokensUsed,
        durationMs,
        claimId: id,
      },
    });

    // Update claim with estimated amount
    await prisma.claim.update({
      where: { id },
      data: { estimatedAmount: estimation.estimatedTotal },
    });

    results.estimation = estimation;

    // Check for auto-approval
    if (results.fraud) {
      const fraudScore = (results.fraud as { score: number }).score;
      await checkAutoApproval(id, estimation.estimatedTotal, fraudScore, session.user.id);
    }
  } catch (err) {
    results.estimationError = (err as Error).message;
  }

  await createAuditLog({
    action: "AI_ANALYSIS_RUN",
    entityType: "CLAIM",
    entityId: id,
    after: {
      analysisTypes: ["EXTRACTION", "FRAUD_SCORING", "ESTIMATION"],
      fraudScore: (results.fraud as { score: number } | undefined)?.score,
      estimatedAmount: (results.estimation as { estimatedTotal: number } | undefined)?.estimatedTotal,
    },
    claimId: id,
    userId: session.user.id,
  });

  const updatedClaim = await prisma.claim.findUnique({
    where: { id },
    include: {
      policyholder: true,
      analyses: { orderBy: { createdAt: "desc" as const }, take: 10 },
    },
  });

  return NextResponse.json({ data: { claim: updatedClaim, results } });
}
