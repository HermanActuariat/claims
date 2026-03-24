import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { CreateContestationSchema } from "@/lib/validations";
import {
  submitContestation,
  getContestationsForAnalysis,
} from "@/lib/explainability-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id: claimId, analysisId } = await params;

  const body = await req.json();
  const parsed = CreateContestationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Verify the analysis belongs to the given claim
  const analysis = await prisma.aIAnalysis.findFirst({
    where: { id: analysisId, claimId },
  });
  if (!analysis) {
    return NextResponse.json(
      { error: "Analyse introuvable pour ce sinistre" },
      { status: 404 }
    );
  }

  try {
    const contestation = await submitContestation(
      analysisId,
      session.user.id,
      parsed.data.reason
    );

    await createAuditLog({
      action: "CONTESTATION_SUBMITTED",
      entityType: "AI_ANALYSIS",
      entityId: analysisId,
      after: { contestationId: contestation.id, reason: parsed.data.reason },
      claimId,
      userId: session.user.id,
    });

    return NextResponse.json({ data: contestation }, { status: 201 });
  } catch (err) {
    console.error("[contest/POST]", err);
    return NextResponse.json(
      { error: "Erreur lors de la soumission de la contestation" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id: claimId, analysisId } = await params;

  // Verify the analysis belongs to the given claim
  const analysis = await prisma.aIAnalysis.findFirst({
    where: { id: analysisId, claimId },
  });
  if (!analysis) {
    return NextResponse.json(
      { error: "Analyse introuvable pour ce sinistre" },
      { status: 404 }
    );
  }

  try {
    const contestations = await getContestationsForAnalysis(analysisId);
    return NextResponse.json({ data: contestations });
  } catch (err) {
    console.error("[contest/GET]", err);
    return NextResponse.json(
      { error: "Erreur lors de la récupération des contestations" },
      { status: 500 }
    );
  }
}
