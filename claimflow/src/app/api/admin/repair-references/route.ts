import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CreateRepairReferenceSchema, RepairReferenceQuerySchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = RepairReferenceQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Parametres invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { page, pageSize, category, vehicleSegment } = parsed.data;

  const where = {
    ...(category ? { category } : {}),
    ...(vehicleSegment ? { vehicleSegment } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.repairReference.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ category: "asc" }, { vehicleSegment: "asc" }],
    }),
    prisma.repairReference.count({ where }),
  ]);

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
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateRepairReferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Donnees invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { regionFactor, validFrom, validUntil, ...rest } = parsed.data;

  const reference = await prisma.repairReference.create({
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
    entityId: reference.id,
    after: reference,
    userId: session.user.id,
  });

  return NextResponse.json({ data: reference }, { status: 201 });
}
