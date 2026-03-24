import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";
import { exportPolicyholderData, logDataAccess } from "@/lib/gdpr-service";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ policyholderId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const { policyholderId } = await params;

  try {
    const policyholder = await prisma.policyholder.findUnique({ where: { id: policyholderId } });
    if (!policyholder) return NextResponse.json({ error: "Assuré introuvable" }, { status: 404 });

    const payload = await exportPolicyholderData(policyholderId);

    await logDataAccess(session.user.id, "Policyholder", policyholderId, "GDPR_EXPORT", req);

    await createAuditLog({
      action: "GDPR_EXPORT_GENERATED",
      entityType: "Policyholder",
      entityId: policyholderId,
      after: { exportedAt: payload.exportedAt },
      userId: session.user.id,
    });

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="gdpr-export-${policyholderId}.json"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/compliance/gdpr/export/[policyholderId]]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
