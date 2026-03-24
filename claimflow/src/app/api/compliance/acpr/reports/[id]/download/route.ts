export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import * as fs from "fs";
import * as path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  const inline = req.nextUrl.searchParams.get("inline") === "true";

  try {
    const report = await prisma.acprReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: "Rapport introuvable" }, { status: 404 });

    if (!report.fileUrl) {
      return NextResponse.json({ error: "Fichier non disponible" }, { status: 404 });
    }

    const absPath = path.resolve(process.cwd(), report.fileUrl);
    if (!fs.existsSync(absPath)) {
      return NextResponse.json({ error: "Fichier introuvable sur le serveur" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(absPath);

    await createAuditLog({
      action: inline ? "ACPR_REPORT_VIEWED" : "ACPR_REPORT_DOWNLOADED",
      entityType: "AcprReport",
      entityId: report.id,
      after: { reportNumber: report.reportNumber },
      userId: session.user.id,
    });

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": inline
          ? `inline; filename="${report.reportNumber}.pdf"`
          : `attachment; filename="${report.reportNumber}.pdf"`,
        "Content-Length": String(fileBuffer.length),
      },
    });
  } catch (err) {
    console.error("[GET /api/compliance/acpr/reports/[id]/download]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
