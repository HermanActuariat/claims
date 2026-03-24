import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeAcprMetrics,
  generateAcprPdfBuffer,
  computeSha256,
  archiveAcprReport,
} from "@/lib/acpr-service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const now = new Date();
  // Rapport du mois précédent
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = prevMonth.getMonth() + 1;
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59);
  const reportNumber = `ACPR-${year}-${String(month).padStart(2, "0")}`;

  try {
    const existing = await prisma.acprReport.findUnique({ where: { reportNumber } });
    if (existing) {
      return NextResponse.json({ message: "Rapport déjà généré", reportNumber });
    }

    const config = await prisma.acprReportConfig.findFirst({ orderBy: { updatedAt: "desc" } });
    const configData = {
      headerTitle: config?.headerTitle ?? "Rapport Mensuel ACPR",
      headerSubtitle: config?.headerSubtitle ?? null,
      footerText: config?.footerText ?? null,
      sections: config?.sections ? (JSON.parse(config.sections) as string[]) : ["claims", "provisions", "fraud"],
    };

    const metrics = await computeAcprMetrics(periodStart, periodEnd);
    const pdfBuffer = await generateAcprPdfBuffer(metrics, configData, reportNumber, periodStart, periodEnd);
    const hash = computeSha256(pdfBuffer);

    const report = await prisma.acprReport.create({
      data: {
        reportNumber,
        periodStart,
        periodEnd,
        status: "GENERATED",
        fileHash: hash,
        claimsOpened: metrics.claimsOpened,
        claimsClosed: metrics.claimsClosed,
        claimsNew: metrics.claimsNew,
        totalProvisioned: metrics.totalProvisioned,
        fraudRate: metrics.fraudRate,
        avgProcessingDays: metrics.avgProcessingDays,
        claimToPremiumRatio: metrics.claimToPremiumRatio,
        indemnitesPaid: metrics.indemnitesPaid,
        indemnitesWaiting: metrics.indemnitesWaiting,
      },
    });

    const archivePath = await archiveAcprReport(report.id, pdfBuffer, hash);
    await prisma.acprReport.update({ where: { id: report.id }, data: { fileUrl: archivePath, status: "ARCHIVED" } });

    return NextResponse.json({ success: true, reportNumber, reportId: report.id });
  } catch (err) {
    console.error("[CRON /api/cron/acpr-monthly]", err);
    return NextResponse.json({ error: "Erreur cron ACPR" }, { status: 500 });
  }
}
