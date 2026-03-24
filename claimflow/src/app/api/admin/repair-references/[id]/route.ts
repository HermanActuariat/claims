import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UpdateRepairReferenceSchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.repairReference.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Reference introuvable" }, { status: 404 });

  const body = await req.json();
  const parsed = UpdateRepairReferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Donnees invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { regionFactor, validFrom, validUntil, ...rest } = parsed.data;

  const updateData: Record<string, unknown> = {
    ...rest,
    updatedById: session.user.id,
  };

  if (regionFactor !== undefined) {
    updateData.regionFactor = regionFactor ? JSON.stringify(regionFactor) : null;
  }
  if (validFrom !== undefined) {
    updateData.validFrom = new Date(validFrom);
  }
  if (validUntil !== undefined) {
    updateData.validUntil = validUntil ? new Date(validUntil) : null;
  }

  try {
    const updated = await prisma.repairReference.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      action: "REPAIR_REFERENCE_UPDATED",
      entityType: "REPAIR_REFERENCE",
      entityId: id,
      before: existing,
      after: updated,
      userId: session.user.id,
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[repair-references/PATCH]", err);
    return NextResponse.json({ error: "Erreur mise a jour reference" }, { status: 500 });
  }
}
