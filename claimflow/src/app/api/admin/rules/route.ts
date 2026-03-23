import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { CreateRuleSchema } from "@/lib/validations";
import { RuleCondition } from "@/types";

export async function GET(req: NextRequest) {
  void req;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const rules = await prisma.automationRule.findMany({
    orderBy: { priority: "asc" },
    include: {
      _count: { select: { executionLogs: true } },
    },
  });

  const parsed = rules.map((rule) => {
    let conditions: RuleCondition[] = [];
    try {
      conditions = JSON.parse(rule.conditions) as RuleCondition[];
    } catch {
      conditions = [];
    }

    let actionParams: Record<string, unknown> | null = null;
    if (rule.actionParams) {
      try {
        actionParams = JSON.parse(rule.actionParams) as Record<string, unknown>;
      } catch {
        actionParams = null;
      }
    }

    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      active: rule.active,
      priority: rule.priority,
      conditions,
      action: rule.action,
      actionParams,
      createdBy: rule.createdBy,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      executionCount: rule._count.executionLogs,
    };
  });

  return NextResponse.json({ data: parsed });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, active, priority, conditions, action, actionParams } = parsed.data;

  // Block AUTO_REJECT at service level even if somehow bypassed in schema
  if ((action as string) === "AUTO_REJECT") {
    return NextResponse.json({ error: "L'action AUTO_REJECT n'est pas autorisée" }, { status: 422 });
  }

  const rule = await prisma.automationRule.create({
    data: {
      name,
      description: description ?? null,
      active: active ?? true,
      priority: priority ?? 0,
      conditions: JSON.stringify(conditions),
      action,
      actionParams: actionParams ? JSON.stringify(actionParams) : null,
      createdBy: session.user.id,
    },
  });

  await createAuditLog({
    action: "RULE_CREATED",
    entityType: "AUTOMATION_RULE",
    entityId: rule.id,
    after: { name, action, priority, active },
    userId: session.user.id,
  });

  return NextResponse.json(
    {
      data: {
        ...rule,
        conditions,
        actionParams: actionParams ?? null,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
