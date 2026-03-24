import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RuleExecutionLogQuerySchema } from "@/lib/validations";
import { RuleExecutionLogItem } from "@/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const queryParams = Object.fromEntries(searchParams.entries());
  const parsed = RuleExecutionLogQuerySchema.safeParse(queryParams);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { page, pageSize, ruleId, claimId } = parsed.data;

  const where: Record<string, unknown> = {};
  if (ruleId) where.ruleId = ruleId;
  if (claimId) where.claimId = claimId;

  const [total, logs] = await Promise.all([
    prisma.ruleExecutionLog.count({ where }),
    prisma.ruleExecutionLog.findMany({
      where,
      include: {
        rule: { select: { name: true } },
      },
      orderBy: { executedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const data: RuleExecutionLogItem[] = logs.map((log) => ({
    id: log.id,
    ruleId: log.ruleId,
    ruleName: log.rule.name,
    claimId: log.claimId,
    action: log.action,
    success: log.success,
    resultData: (() => {
      if (!log.resultData) return null;
      try {
        return JSON.parse(log.resultData) as Record<string, unknown>;
      } catch {
        return null;
      }
    })(),
    errorMessage: log.errorMessage,
    dryRun: log.dryRun,
    executedAt: log.executedAt.toISOString(),
  }));

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
