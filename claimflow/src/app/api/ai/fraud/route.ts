import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AIFraudSchema } from "@/lib/validations";
import { analyzeFraud } from "@/lib/ai-service";
import { createAuditLog } from "@/lib/audit";
import { checkFraudEscalation } from "@/lib/claim-service";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = AIFraudSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const claim = await prisma.claim.findUnique({
      where: { id: parsed.data.claimId },
      include: { policyholder: true, documents: true },
    });
    if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

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

    const { result, tokensUsed, durationMs } = await analyzeFraud(claimData, claim.id);

    const analysis = await prisma.aIAnalysis.create({
      data: {
        type: "FRAUD_SCORING",
        inputData: JSON.stringify(claimData),
        outputData: JSON.stringify(result),
        tokensUsed,
        durationMs,
        claimId: claim.id,
      },
    });

    await prisma.claim.update({
      where: { id: claim.id },
      data: { fraudScore: result.score, fraudRisk: result.risk },
    });

    await checkFraudEscalation(claim.id, result.score, session.user.id);

    await createAuditLog({
      action: "AI_ANALYSIS_RUN",
      entityType: "CLAIM",
      entityId: claim.id,
      after: { type: "FRAUD_SCORING", score: result.score, risk: result.risk },
      claimId: claim.id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: { analysis, result } });
  } catch (err) {
    console.error("[AI/fraud]", err);
    return NextResponse.json({ error: "Erreur analyse fraude" }, { status: 500 });
  }
}
