import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { UpdateRuleSchema } from "@/lib/validations";
import { RuleCondition } from "@/types";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const { id } = await params;
  const body: unknown = await req.json();
  const parsed = UpdateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.automationRule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Règle introuvable" }, { status: 404 });

  // Block AUTO_REJECT at service level
  if (parsed.data.action && (parsed.data.action as string) === "AUTO_REJECT") {
    return NextResponse.json({ error: "L'action AUTO_REJECT n'est pas autorisée" }, { status: 422 });
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.active !== undefined) updateData.active = parsed.data.active;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
  if (parsed.data.conditions !== undefined) updateData.conditions = JSON.stringify(parsed.data.conditions);
  if (parsed.data.action !== undefined) updateData.action = parsed.data.action;
  if (parsed.data.actionParams !== undefined) {
    updateData.actionParams = parsed.data.actionParams ? JSON.stringify(parsed.data.actionParams) : null;
  }

  const updated = await prisma.automationRule.update({
    where: { id },
    data: updateData,
  });

  await createAuditLog({
    action: "RULE_UPDATED",
    entityType: "AUTOMATION_RULE",
    entityId: id,
    before: {
      name: existing.name,
      action: existing.action,
      active: existing.active,
      priority: existing.priority,
    },
    after: updateData,
    userId: session.user.id,
  });

  let conditions: RuleCondition[] = [];
  try {
    conditions = JSON.parse(updated.conditions) as RuleCondition[];
  } catch {
    conditions = [];
  }

  let actionParams: Record<string, unknown> | null = null;
  if (updated.actionParams) {
    try {
      actionParams = JSON.parse(updated.actionParams) as Record<string, unknown>;
    } catch {
      actionParams = null;
    }
  }

  return NextResponse.json({
    data: {
      ...updated,
      conditions,
      actionParams,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  void req;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.automationRule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Règle introuvable" }, { status: 404 });

  await prisma.automationRule.delete({ where: { id } });

  await createAuditLog({
    action: "RULE_DELETED",
    entityType: "AUTOMATION_RULE",
    entityId: id,
    before: { name: existing.name, action: existing.action, active: existing.active },
    userId: session.user.id,
  });

  return NextResponse.json({ data: { deleted: true, id } });
}
