import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const QuerySchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
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

  const { quarter, page, pageSize } = queryResult.data;
  const where = quarter ? { periodQuarter: quarter } : {};

  try {
    const [provisions, total] = await Promise.all([
      prisma.solvencyProvision.findMany({
        where,
        orderBy: { computedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { claim: { select: { id: true, claimNumber: true, status: true, type: true } } },
      }),
      prisma.solvencyProvision.count({ where }),
    ]);

    return NextResponse.json({ data: provisions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error("[GET /api/compliance/solvency/provisions]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
