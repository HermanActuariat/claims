import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { UpdateProviderConfigSchema } from "@/lib/validations";
import { z } from "zod";

const PatchBodySchema = z.object({
  provider: z.string().min(1),
}).merge(UpdateProviderConfigSchema);

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const configs = await prisma.aIProviderConfig.findMany({
    orderBy: { priority: "asc" },
  });

  return NextResponse.json({ data: configs });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { provider, ...updateData } = parsed.data;

  const existing = await prisma.aIProviderConfig.findUnique({
    where: { provider },
  });

  if (!existing) {
    return NextResponse.json({ error: "Provider introuvable" }, { status: 404 });
  }

  const updated = await prisma.aIProviderConfig.update({
    where: { provider },
    data: updateData,
  });

  await createAuditLog({
    action: "PROVIDER_CONFIG_UPDATED",
    entityType: "AI_PROVIDER",
    entityId: updated.id,
    before: {
      active: existing.active,
      priority: existing.priority,
      defaultModel: existing.defaultModel,
      maxTokens: existing.maxTokens,
    },
    after: {
      active: updated.active,
      priority: updated.priority,
      defaultModel: updated.defaultModel,
      maxTokens: updated.maxTokens,
    },
    metadata: { provider },
    userId: session.user.id,
  });

  return NextResponse.json({ data: updated });
}
