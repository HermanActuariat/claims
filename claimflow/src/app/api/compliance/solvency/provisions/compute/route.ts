import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";
import { computePortfolioProvisions } from "@/lib/solvency-service";
import { z } from "zod";

const ComputeSchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, "Format attendu : YYYY-Q[1-4]"),
  scope: z.enum(["ALL", "OPEN_ONLY"]).default("ALL"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = ComputeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { quarter, scope } = parsed.data;

  try {
    const result = await computePortfolioProvisions(quarter, scope, session.user.id);

    await createAuditLog({
      action: "SOLVENCY_PROVISIONS_COMPUTED",
      entityType: "SolvencyProvision",
      entityId: quarter,
      after: { quarter, scope, claimCount: result.claimCount, totalBE: result.totalBE, totalSCR: result.totalSCR },
      userId: session.user.id,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/solvency/provisions/compute]", err);
    return NextResponse.json({ error: "Erreur lors du calcul des provisions" }, { status: 500 });
  }
}
