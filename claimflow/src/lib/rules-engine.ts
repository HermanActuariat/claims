import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { RuleAction, RuleCondition, RuleExecutionLogItem, RuleSimulationResult } from "@/types";

// ─── Condition Evaluation ────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current !== null && current !== undefined && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function evaluateCondition(
  condition: RuleCondition,
  context: Record<string, unknown>
): boolean {
  const actual = getNestedValue(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual as string);
    default:
      return false;
  }
}

// ─── Rule Evaluation ─────────────────────────────────────────────────────────

export function evaluateRule(
  rule: { conditions: RuleCondition[]; action: RuleAction },
  context: Record<string, unknown>
): {
  matched: boolean;
  conditionResults: { field: string; matched: boolean; actual: unknown; expected: unknown }[];
} {
  const conditionResults = rule.conditions.map((condition) => ({
    field: condition.field,
    matched: evaluateCondition(condition, context),
    actual: getNestedValue(context, condition.field),
    expected: condition.value,
  }));

  const matched = conditionResults.every((r) => r.matched);
  return { matched, conditionResults };
}

// ─── Guardrails ──────────────────────────────────────────────────────────────

export function checkGuardrails(
  action: RuleAction,
  context: Record<string, unknown>
): { allowed: boolean; reason?: string } {
  if (action === "AUTO_APPROVE") {
    const fraudScore = context.fraudScore as number | null;
    const estimatedAmount = context.estimatedAmount as number | null;
    const explainabilityReport = context.explainabilityReport as unknown;

    if (fraudScore !== null && fraudScore !== undefined && fraudScore > 50) {
      return { allowed: false, reason: `Score fraude trop élevé (${fraudScore} > 50)` };
    }
    if (estimatedAmount !== null && estimatedAmount !== undefined && estimatedAmount > 5000) {
      return { allowed: false, reason: `Montant estimé trop élevé (${estimatedAmount} > 5000€)` };
    }
    if (!explainabilityReport) {
      return { allowed: false, reason: "Rapport d'explicabilité manquant" };
    }
  }

  // AUTO_REJECT is always blocked — downgraded to ESCALATE_TO_MANAGER
  if ((action as string) === "AUTO_REJECT") {
    return { allowed: false, reason: "AUTO_REJECT est désactivé — escalade vers manager" };
  }

  return { allowed: true };
}

// ─── Action Application ──────────────────────────────────────────────────────

export async function applyRuleAction(
  claimId: string,
  action: RuleAction,
  actionParams: Record<string, unknown> | null,
  userId: string
): Promise<void> {
  switch (action) {
    case "AUTO_APPROVE": {
      await prisma.claim.update({
        where: { id: claimId },
        data: { status: "APPROVED" },
      });
      await createAuditLog({
        action: "STATUS_CHANGED",
        entityType: "CLAIM",
        entityId: claimId,
        after: { status: "APPROVED", triggeredBy: "automation_rule" },
        metadata: { automationAction: "AUTO_APPROVE", actionParams },
        claimId,
        userId,
      });
      break;
    }

    case "ESCALATE_TO_MANAGER": {
      const manager = await prisma.user.findFirst({
        where: { role: "MANAGER", active: true },
        orderBy: { createdAt: "asc" },
      });
      if (manager) {
        await prisma.claim.update({
          where: { id: claimId },
          data: { assignedToID: manager.id },
        });
        await createAuditLog({
          action: "CLAIM_ASSIGNED",
          entityType: "CLAIM",
          entityId: claimId,
          after: { assignedToId: manager.id, triggeredBy: "automation_rule" },
          metadata: { automationAction: "ESCALATE_TO_MANAGER", assignedTo: manager.name, actionParams },
          claimId,
          userId,
        });
      }
      break;
    }

    case "REQUEST_INFO": {
      await prisma.claim.update({
        where: { id: claimId },
        data: { status: "INFO_REQUESTED" },
      });
      await createAuditLog({
        action: "STATUS_CHANGED",
        entityType: "CLAIM",
        entityId: claimId,
        after: { status: "INFO_REQUESTED", triggeredBy: "automation_rule" },
        metadata: { automationAction: "REQUEST_INFO", actionParams },
        claimId,
        userId,
      });
      break;
    }

    case "FLAG_FRAUD": {
      await prisma.claim.update({
        where: { id: claimId },
        data: { fraudRisk: "HIGH" },
      });
      await createAuditLog({
        action: "RULE_EXECUTED",
        entityType: "CLAIM",
        entityId: claimId,
        after: { fraudRisk: "HIGH", triggeredBy: "automation_rule" },
        metadata: { automationAction: "FLAG_FRAUD", actionParams },
        claimId,
        userId,
      });
      break;
    }
  }
}

// ─── Build Claim Context ──────────────────────────────────────────────────────

async function buildClaimContext(claimId: string): Promise<Record<string, unknown>> {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      policyholder: true,
      analyses: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!claim) {
    throw new Error(`Sinistre ${claimId} introuvable`);
  }

  // Extract the latest explainability report from fraud scoring analyses
  const fraudAnalysis = claim.analyses.find((a) => a.type === "FRAUD_SCORING");
  let explainabilityReport: unknown = null;
  if (fraudAnalysis?.explainabilityReport) {
    try {
      explainabilityReport = JSON.parse(fraudAnalysis.explainabilityReport);
    } catch {
      explainabilityReport = null;
    }
  }

  return {
    id: claim.id,
    status: claim.status,
    type: claim.type,
    fraudScore: claim.fraudScore,
    fraudRisk: claim.fraudRisk,
    estimatedAmount: claim.estimatedAmount,
    approvedAmount: claim.approvedAmount,
    thirdPartyInvolved: claim.thirdPartyInvolved,
    explainabilityReport,
    policyholder: {
      id: claim.policyholder.id,
      coverageType: claim.policyholder.coverageType,
      vehicleMake: claim.policyholder.vehicleMake,
      vehicleModel: claim.policyholder.vehicleModel,
      vehicleYear: claim.policyholder.vehicleYear,
    },
  };
}

// ─── Execute Rules For Claim ──────────────────────────────────────────────────

export async function executeRulesForClaim(
  claimId: string,
  userId: string,
  dryRun = false
): Promise<RuleExecutionLogItem[]> {
  const rules = await prisma.automationRule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  if (rules.length === 0) return [];

  const context = await buildClaimContext(claimId);
  const logs: RuleExecutionLogItem[] = [];

  for (const rule of rules) {
    let conditions: RuleCondition[] = [];
    try {
      conditions = JSON.parse(rule.conditions) as RuleCondition[];
    } catch {
      conditions = [];
    }

    const action = rule.action as RuleAction;
    const { matched, conditionResults } = evaluateRule({ conditions, action }, context);

    if (!matched) {
      // Log non-matching rule execution in dry run only
      if (dryRun) {
        logs.push({
          id: `dry-${rule.id}`,
          ruleId: rule.id,
          ruleName: rule.name,
          claimId,
          action: rule.action,
          success: true,
          resultData: { matched: false, conditionResults },
          errorMessage: null,
          dryRun: true,
          executedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    const guardrail = checkGuardrails(action, context);
    const effectiveAction = guardrail.allowed
      ? action
      : action === ("AUTO_REJECT" as RuleAction)
        ? ("ESCALATE_TO_MANAGER" as RuleAction)
        : null;

    let success = true;
    let errorMessage: string | null = null;
    let resultData: Record<string, unknown> = {
      matched: true,
      conditionResults,
      guardrailAllowed: guardrail.allowed,
      guardrailReason: guardrail.reason ?? null,
      effectiveAction,
    };

    if (!dryRun && effectiveAction) {
      try {
        let actionParams: Record<string, unknown> | null = null;
        if (rule.actionParams) {
          try {
            actionParams = JSON.parse(rule.actionParams) as Record<string, unknown>;
          } catch {
            actionParams = null;
          }
        }
        await applyRuleAction(claimId, effectiveAction, actionParams, userId);
      } catch (err) {
        success = false;
        errorMessage = err instanceof Error ? err.message : String(err);
        resultData = { ...resultData, error: errorMessage };
      }
    }

    if (!dryRun) {
      const logEntry = await prisma.ruleExecutionLog.create({
        data: {
          ruleId: rule.id,
          claimId,
          action: effectiveAction ?? rule.action,
          success,
          resultData: JSON.stringify(resultData),
          errorMessage,
          dryRun: false,
        },
      });

      await createAuditLog({
        action: "RULE_EXECUTED",
        entityType: "AUTOMATION_RULE",
        entityId: rule.id,
        after: { claimId, action: effectiveAction ?? rule.action, success },
        metadata: resultData,
        claimId,
        userId,
      });

      logs.push({
        id: logEntry.id,
        ruleId: logEntry.ruleId,
        ruleName: rule.name,
        claimId: logEntry.claimId,
        action: logEntry.action,
        success: logEntry.success,
        resultData: logEntry.resultData ? (JSON.parse(logEntry.resultData) as Record<string, unknown>) : null,
        errorMessage: logEntry.errorMessage,
        dryRun: logEntry.dryRun,
        executedAt: logEntry.executedAt.toISOString(),
      });
    } else {
      logs.push({
        id: `dry-${rule.id}`,
        ruleId: rule.id,
        ruleName: rule.name,
        claimId,
        action: effectiveAction ?? rule.action,
        success: true,
        resultData,
        errorMessage: null,
        dryRun: true,
        executedAt: new Date().toISOString(),
      });
    }
  }

  return logs;
}

// ─── Simulate Rules For Claim ─────────────────────────────────────────────────

export async function simulateRulesForClaim(claimId: string): Promise<RuleSimulationResult[]> {
  const rules = await prisma.automationRule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  if (rules.length === 0) return [];

  const context = await buildClaimContext(claimId);
  const results: RuleSimulationResult[] = [];

  for (const rule of rules) {
    let conditions: RuleCondition[] = [];
    try {
      conditions = JSON.parse(rule.conditions) as RuleCondition[];
    } catch {
      conditions = [];
    }

    const action = rule.action as RuleAction;
    const { matched, conditionResults } = evaluateRule({ conditions, action }, context);

    let effectiveAction: RuleAction | null = null;
    if (matched) {
      const guardrail = checkGuardrails(action, context);
      effectiveAction = guardrail.allowed ? action : null;
    }

    results.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched,
      action: effectiveAction,
      conditionResults,
    });
  }

  return results;
}
