import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ClaimStatusSchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";
import { isValidTransition } from "@/lib/claim-service";
import { createNotification } from "@/lib/notification-service";
import { sendClaimStatusEmail } from "@/lib/email-service";
import { executeRulesForClaim } from "@/lib/rules-engine";
import { ClaimStatus, CLAIM_STATUS_LABELS } from "@/types";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = ClaimStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { status: newStatus, reason, approvedAmount } = parsed.data;

  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  // Validate transition
  if (!isValidTransition(claim.status as ClaimStatus, newStatus as ClaimStatus)) {
    return NextResponse.json({
      error: `Transition invalide: ${claim.status} → ${newStatus}`,
    }, { status: 422 });
  }

  // Permission check: only manager/admin can approve/reject
  if (["APPROVED", "REJECTED"].includes(newStatus) && session.user.role === "HANDLER") {
    return NextResponse.json({ error: "Accès refusé: approbation réservée aux managers" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === "APPROVED" && approvedAmount) {
    updateData.approvedAmount = approvedAmount;
  }

  const updated = await prisma.claim.update({
    where: { id },
    data: updateData,
    include: {
      policyholder: true,
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      createdBy: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  await createAuditLog({
    action: "STATUS_CHANGED",
    entityType: "CLAIM",
    entityId: claim.id,
    before: { status: claim.status },
    after: { status: newStatus, ...(approvedAmount ? { approvedAmount } : {}), ...(reason ? { reason } : {}) },
    claimId: claim.id,
    userId: session.user.id,
  });

  const statusLabel = CLAIM_STATUS_LABELS[newStatus as ClaimStatus] ?? newStatus;

  // Notification in-app pour le gestionnaire assigné
  if (updated.assignedToID) {
    await createNotification({
      userId: updated.assignedToID,
      type: "STATUS_CHANGED",
      title: `Statut mis à jour — ${claim.claimNumber}`,
      body: `Le sinistre ${claim.claimNumber} est maintenant "${statusLabel}".`,
      claimId: claim.id,
    });
  }

  // Email assuré pour les changements de statut significatifs
  if (["APPROVED", "REJECTED", "INFO_REQUESTED"].includes(newStatus)) {
    await sendClaimStatusEmail({
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      status: newStatus,
      policyholderEmail: updated.policyholder.email,
      policyholderName: `${updated.policyholder.firstName} ${updated.policyholder.lastName}`,
    });
  }

  // Trigger automation rules after status change
  await executeRulesForClaim(id, session.user.id).catch((err) => {
    console.error(`[claims/${id}/status] Rules engine failed after status change:`, err);
  });

  return NextResponse.json({ data: updated });
}
