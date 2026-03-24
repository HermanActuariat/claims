import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { ResolveContestationSchema } from "@/lib/validations";
import { resolveContestation } from "@/lib/explainability-service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string; contestId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Only MANAGER and ADMIN can resolve contestations
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json(
      { error: "Accès refusé — rôle MANAGER ou ADMIN requis" },
      { status: 403 }
    );
  }

  const { id: claimId, analysisId, contestId } = await params;

  const body = await req.json();
  const parsed = ResolveContestationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Verify the contestation belongs to the given analysis and claim
  const contestation = await prisma.aIContestation.findFirst({
    where: {
      id: contestId,
      analysisId,
      analysis: { claimId },
    },
  });
  if (!contestation) {
    return NextResponse.json(
      { error: "Contestation introuvable" },
      { status: 404 }
    );
  }

  if (contestation.status !== "PENDING") {
    return NextResponse.json(
      { error: "La contestation a déjà été traitée" },
      { status: 409 }
    );
  }

  try {
    const resolved = await resolveContestation(
      contestId,
      session.user.id,
      parsed.data.status,
      parsed.data.resolution
    );

    await createAuditLog({
      action: "CONTESTATION_RESOLVED",
      entityType: "AI_ANALYSIS",
      entityId: analysisId,
      before: { status: "PENDING" },
      after: {
        contestationId: contestId,
        status: parsed.data.status,
        resolution: parsed.data.resolution,
      },
      claimId,
      userId: session.user.id,
    });

    return NextResponse.json({ data: resolved });
  } catch (err) {
    console.error("[contest/[contestId]/PATCH]", err);
    return NextResponse.json(
      { error: "Erreur lors de la résolution de la contestation" },
      { status: 500 }
    );
  }
}
