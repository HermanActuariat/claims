import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import {
  computeAcprMetrics,
  generateAcprPdfBuffer,
  computeSha256,
  archiveAcprReport,
} from "@/lib/acpr-service";
import { z } from "zod";

const GenerateReportSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const queryResult = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!queryResult.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: queryResult.error.flatten() }, { status: 400 });
  }

  const { page, pageSize } = queryResult.data;

  try {
    const [reports, total] = await Promise.all([
      prisma.acprReport.findMany({
        orderBy: { generatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { generatedBy: { select: { id: true, name: true, email: true } } },
      }),
      prisma.acprReport.count(),
    ]);

    return NextResponse.json({
      data: reports,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("[GET /api/compliance/acpr/reports]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = GenerateReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { year, month } = parsed.data;
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59);
  const reportNumber = `ACPR-${year}-${String(month).padStart(2, "0")}`;

  try {
    // Récupérer la config (ou valeurs par défaut)
    const config = await prisma.acprReportConfig.findFirst({ orderBy: { updatedAt: "desc" } });
    const configData = {
      headerTitle: config?.headerTitle ?? "Rapport Mensuel ACPR",
      headerSubtitle: config?.headerSubtitle ?? "Données de sinistralité automobile",
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
        generatedById: session.user.id,
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

    await createAuditLog({
      action: "ACPR_REPORT_GENERATED",
      entityType: "AcprReport",
      entityId: report.id,
      after: { reportNumber, year, month },
      userId: session.user.id,
    });

    return NextResponse.json({ data: report }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/acpr/reports]", err);
    return NextResponse.json({ error: "Erreur lors de la génération du rapport" }, { status: 500 });
  }
}
