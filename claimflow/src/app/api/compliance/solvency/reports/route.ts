import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

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
      prisma.solvencyReport.findMany({
        orderBy: { generatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { generatedBy: { select: { id: true, name: true, email: true } } },
      }),
      prisma.solvencyReport.count(),
    ]);

    return NextResponse.json({ data: reports, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error("[GET /api/compliance/solvency/reports]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
