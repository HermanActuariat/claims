export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";
import { generateComplianceXlsx } from "@/lib/excel-service";
import type { ExcelExportParams } from "@/types";
import { z } from "zod";

const QuerySchema = z.object({
  period: z.enum(["month", "quarter", "year"]),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  claimType: z.string().default("ALL"),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const queryResult = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!queryResult.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: queryResult.error.flatten() }, { status: 400 });
  }

  const params = queryResult.data as ExcelExportParams;

  try {
    const buffer = await generateComplianceXlsx(params);

    const periodLabel =
      params.period === "month"
        ? `${params.year}-${String(params.month).padStart(2, "0")}`
        : params.period === "quarter"
        ? `${params.year}-${params.quarter}`
        : String(params.year);

    await createAuditLog({
      action: "EXCEL_EXPORT_GENERATED",
      entityType: "System",
      entityId: "xlsx-export",
      after: { period: params.period, year: params.year, claimType: params.claimType },
      userId: session.user.id,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="claimflow-compliance-${periodLabel}.xlsx"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    console.error("[GET /api/compliance/export/xlsx]", err);
    return NextResponse.json({ error: "Erreur lors de la génération du fichier Excel" }, { status: 500 });
  }
}
