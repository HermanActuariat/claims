import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { anonymizePolicyholder } from "@/lib/gdpr-service";
import { z } from "zod";

const CreateErasureSchema = z.object({
  policyholderId: z.string().min(1),
  reason: z.string().min(1).max(1000).optional(),
});

const QuerySchema = z.object({
  status: z.enum(["PENDING", "EXECUTED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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

  const { status, page, pageSize } = queryResult.data;

  try {
    const where = status ? { status } : {};
    const [requests, total] = await Promise.all([
      prisma.gdprErasureRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          executedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.gdprErasureRequest.count({ where }),
    ]);

    return NextResponse.json({ data: requests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error("[GET /api/compliance/gdpr/erasure]", err);
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
  const parsed = CreateErasureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { policyholderId, reason } = parsed.data;

  try {
    const policyholder = await prisma.policyholder.findUnique({ where: { id: policyholderId } });
    if (!policyholder) return NextResponse.json({ error: "Assuré introuvable" }, { status: 404 });

    const erasureRequest = await prisma.gdprErasureRequest.create({
      data: {
        policyholderId,
        metadata: reason ? JSON.stringify({ reason }) : null,
        requestedById: session.user.id,
        status: "PENDING",
      },
    });

    // Anonymiser immédiatement
    await anonymizePolicyholder(policyholderId, erasureRequest.id, session.user.id);

    await createAuditLog({
      action: "GDPR_ERASURE_REQUESTED",
      entityType: "GdprErasureRequest",
      entityId: erasureRequest.id,
      after: { policyholderId, reason: reason ?? null, status: "EXECUTED" },
      userId: session.user.id,
    });

    const updated = await prisma.gdprErasureRequest.findUnique({ where: { id: erasureRequest.id } });
    return NextResponse.json({ data: updated }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/gdpr/erasure]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
