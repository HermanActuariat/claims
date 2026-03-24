import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { UpdateRepairReferenceSchema } from "@/lib/validations";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.repairReference.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Référence introuvable" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const parsed = UpdateRepairReferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { regionFactor, validFrom, validUntil, ...rest } = parsed.data;

  const updateData: Record<string, unknown> = { ...rest, updatedById: session.user.id };
  if (regionFactor !== undefined) updateData.regionFactor = regionFactor ? JSON.stringify(regionFactor) : null;
  if (validFrom !== undefined) updateData.validFrom = new Date(validFrom);
  if (validUntil !== undefined) updateData.validUntil = validUntil ? new Date(validUntil) : null;

  try {
    const updated = await prisma.repairReference.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      action: "REPAIR_REFERENCE_UPDATED",
      entityType: "REPAIR_REFERENCE",
      entityId: id,
      before: { category: existing.category, subcategory: existing.subcategory, avgPartCost: existing.avgPartCost },
      after: { category: updated.category, subcategory: updated.subcategory, avgPartCost: updated.avgPartCost },
      userId: session.user.id,
    });

    return NextResponse.json({
      data: {
        ...updated,
        regionFactor: updated.regionFactor ? (JSON.parse(updated.regionFactor) as Record<string, number>) : null,
        validFrom: updated.validFrom.toISOString(),
        validUntil: updated.validUntil?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[admin/repair-references/PATCH]", err);
    return NextResponse.json(
      { error: "Erreur lors de la mise à jour" },
      { status: 500 }
    );
  }
}
