import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().optional(),
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

  const { page, pageSize, entityType } = queryResult.data;
  const where = entityType ? { entityType } : {};

  try {
    const [logs, total] = await Promise.all([
      prisma.gdprDataAccessLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.gdprDataAccessLog.count({ where }),
    ]);

    return NextResponse.json({ data: logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error("[GET /api/compliance/gdpr/access-logs]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
