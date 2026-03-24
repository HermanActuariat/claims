import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import * as fs from "fs";
import * as path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const report = await prisma.acprReport.findUnique({
      where: { id },
      include: { generatedBy: { select: { id: true, name: true, email: true } } },
    });

    if (!report) return NextResponse.json({ error: "Rapport introuvable" }, { status: 404 });

    return NextResponse.json({ data: report });
  } catch (err) {
    console.error("[GET /api/compliance/acpr/reports/[id]]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const report = await prisma.acprReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: "Rapport introuvable" }, { status: 404 });

    // Supprimer le fichier PDF si existant
    if (report.fileUrl) {
      const absPath = path.resolve(process.cwd(), report.fileUrl);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }

    await prisma.acprReport.delete({ where: { id } });

    await createAuditLog({
      action: "ACPR_REPORT_DELETED",
      entityType: "AcprReport",
      entityId: id,
      after: { reportNumber: report.reportNumber },
      userId: session.user.id,
    });

    return NextResponse.json({ message: "Rapport supprimé" });
  } catch (err) {
    console.error("[DELETE /api/compliance/acpr/reports/[id]]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
