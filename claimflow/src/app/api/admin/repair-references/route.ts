import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { CreateRepairReferenceSchema, RepairReferenceQuerySchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = RepairReferenceQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { category, vehicleSegment, page, pageSize } = parsed.data;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (vehicleSegment) where.vehicleSegment = vehicleSegment;

  const [total, refs] = await Promise.all([
    prisma.repairReference.count({ where }),
    prisma.repairReference.findMany({
      where,
      orderBy: [{ category: "asc" }, { vehicleSegment: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const data = refs.map((ref) => ({
    ...ref,
    regionFactor: ref.regionFactor ? (JSON.parse(ref.regionFactor) as Record<string, number>) : null,
    validFrom: ref.validFrom.toISOString(),
    validUntil: ref.validUntil?.toISOString() ?? null,
    createdAt: ref.createdAt.toISOString(),
    updatedAt: ref.updatedAt.toISOString(),
  }));

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = CreateRepairReferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { regionFactor, validFrom, validUntil, ...rest } = parsed.data;

  try {
    const ref = await prisma.repairReference.create({
      data: {
        ...rest,
        regionFactor: regionFactor ? JSON.stringify(regionFactor) : null,
        validFrom: new Date(validFrom),
        validUntil: validUntil ? new Date(validUntil) : null,
        updatedById: session.user.id,
      },
    });

    await createAuditLog({
      action: "REPAIR_REFERENCE_CREATED",
      entityType: "REPAIR_REFERENCE",
      entityId: ref.id,
      after: { category: rest.category, subcategory: rest.subcategory, vehicleSegment: rest.vehicleSegment },
      userId: session.user.id,
    });

    return NextResponse.json(
      {
        data: {
          ...ref,
          regionFactor: ref.regionFactor ? (JSON.parse(ref.regionFactor) as Record<string, number>) : null,
          validFrom: ref.validFrom.toISOString(),
          validUntil: ref.validUntil?.toISOString() ?? null,
          createdAt: ref.createdAt.toISOString(),
          updatedAt: ref.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[admin/repair-references/POST]", err);
    return NextResponse.json(
      { error: "Erreur lors de la création" },
      { status: 500 }
    );
  }
}
