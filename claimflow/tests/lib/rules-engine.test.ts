/**
 * Tests — src/lib/rules-engine.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRule: { findMany: vi.fn() },
    ruleExecutionLog: { create: vi.fn() },
    claim: { findUnique: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notification-service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "n1" }),
}));

import {
  evaluateCondition,
  evaluateRule,
  checkGuardrails,
} from "@/lib/rules-engine";
import { RuleCondition, RuleAction } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe("evaluateCondition", () => {
  it("eq operator matches equal values", () => {
    const condition: RuleCondition = { field: "status", operator: "eq", value: "SUBMITTED" };
    expect(evaluateCondition(condition, { status: "SUBMITTED" })).toBe(true);
    expect(evaluateCondition(condition, { status: "APPROVED" })).toBe(false);
  });

  it("neq operator matches non-equal values", () => {
    const condition: RuleCondition = { field: "status", operator: "neq", value: "CLOSED" };
    expect(evaluateCondition(condition, { status: "SUBMITTED" })).toBe(true);
    expect(evaluateCondition(condition, { status: "CLOSED" })).toBe(false);
  });

  it("gt operator with numbers", () => {
    const condition: RuleCondition = { field: "fraudScore", operator: "gt", value: 50 };
    expect(evaluateCondition(condition, { fraudScore: 75 })).toBe(true);
    expect(evaluateCondition(condition, { fraudScore: 50 })).toBe(false);
    expect(evaluateCondition(condition, { fraudScore: 25 })).toBe(false);
  });

  it("gte operator with numbers", () => {
    const condition: RuleCondition = { field: "fraudScore", operator: "gte", value: 50 };
    expect(evaluateCondition(condition, { fraudScore: 50 })).toBe(true);
    expect(evaluateCondition(condition, { fraudScore: 49 })).toBe(false);
  });

  it("lt operator with numbers", () => {
    const condition: RuleCondition = { field: "estimatedAmount", operator: "lt", value: 1000 };
    expect(evaluateCondition(condition, { estimatedAmount: 500 })).toBe(true);
    expect(evaluateCondition(condition, { estimatedAmount: 1000 })).toBe(false);
  });

  it("lte operator with numbers", () => {
    const condition: RuleCondition = { field: "estimatedAmount", operator: "lte", value: 1000 };
    expect(evaluateCondition(condition, { estimatedAmount: 1000 })).toBe(true);
    expect(evaluateCondition(condition, { estimatedAmount: 1001 })).toBe(false);
  });

  it("contains operator with strings", () => {
    const condition: RuleCondition = { field: "type", operator: "contains", value: "COL" };
    expect(evaluateCondition(condition, { type: "COLLISION" })).toBe(true);
    expect(evaluateCondition(condition, { type: "THEFT" })).toBe(false);
  });

  it("in operator with arrays", () => {
    const condition: RuleCondition = {
      field: "status",
      operator: "in",
      value: ["SUBMITTED", "UNDER_REVIEW"],
    };
    expect(evaluateCondition(condition, { status: "SUBMITTED" })).toBe(true);
    expect(evaluateCondition(condition, { status: "UNDER_REVIEW" })).toBe(true);
    expect(evaluateCondition(condition, { status: "CLOSED" })).toBe(false);
  });

  it("nested field with dot notation", () => {
    const condition: RuleCondition = {
      field: "policyholder.coverageType",
      operator: "eq",
      value: "ALL_RISKS",
    };
    const context = { policyholder: { coverageType: "ALL_RISKS" } };
    expect(evaluateCondition(condition, context)).toBe(true);

    const context2 = { policyholder: { coverageType: "THIRD_PARTY" } };
    expect(evaluateCondition(condition, context2)).toBe(false);
  });

  it("returns false for unknown operator", () => {
    const condition = { field: "status", operator: "unknown" as never, value: "X" };
    expect(evaluateCondition(condition, { status: "X" })).toBe(false);
  });

  it("gt returns false when actual is not a number", () => {
    const condition: RuleCondition = { field: "score", operator: "gt", value: 10 };
    expect(evaluateCondition(condition, { score: "high" })).toBe(false);
  });
});

// ─── evaluateRule ─────────────────────────────────────────────────────────────

describe("evaluateRule", () => {
  it("returns matched=true when all conditions pass (AND logic)", () => {
    const rule = {
      conditions: [
        { field: "fraudScore", operator: "gt" as const, value: 50 },
        { field: "status", operator: "eq" as const, value: "SUBMITTED" },
      ],
      action: "FLAG_FRAUD" as RuleAction,
    };
    const context = { fraudScore: 80, status: "SUBMITTED" };
    const { matched, conditionResults } = evaluateRule(rule, context);

    expect(matched).toBe(true);
    expect(conditionResults).toHaveLength(2);
    expect(conditionResults[0].matched).toBe(true);
    expect(conditionResults[1].matched).toBe(true);
  });

  it("returns matched=false if any condition fails", () => {
    const rule = {
      conditions: [
        { field: "fraudScore", operator: "gt" as const, value: 50 },
        { field: "status", operator: "eq" as const, value: "SUBMITTED" },
      ],
      action: "FLAG_FRAUD" as RuleAction,
    };
    const context = { fraudScore: 30, status: "SUBMITTED" };
    const { matched, conditionResults } = evaluateRule(rule, context);

    expect(matched).toBe(false);
    expect(conditionResults[0].matched).toBe(false);
    expect(conditionResults[1].matched).toBe(true);
  });

  it("returns matched=false when conditions list is empty", () => {
    const rule = { conditions: [], action: "AUTO_APPROVE" as RuleAction };
    const { matched } = evaluateRule(rule, {});
    expect(matched).toBe(true); // every() on empty array is true
  });

  it("exposes actual and expected values in conditionResults", () => {
    const rule = {
      conditions: [{ field: "fraudScore", operator: "gt" as const, value: 50 }],
      action: "FLAG_FRAUD" as RuleAction,
    };
    const context = { fraudScore: 90 };
    const { conditionResults } = evaluateRule(rule, context);

    expect(conditionResults[0].actual).toBe(90);
    expect(conditionResults[0].expected).toBe(50);
    expect(conditionResults[0].field).toBe("fraudScore");
  });
});

// ─── checkGuardrails ──────────────────────────────────────────────────────────

describe("checkGuardrails", () => {
  it("blocks AUTO_APPROVE when fraudScore > 50", () => {
    const result = checkGuardrails("AUTO_APPROVE", {
      fraudScore: 75,
      estimatedAmount: 1000,
      explainabilityReport: { factors: [] },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("fraude");
  });

  it("blocks AUTO_APPROVE when estimatedAmount > 5000", () => {
    const result = checkGuardrails("AUTO_APPROVE", {
      fraudScore: 20,
      estimatedAmount: 8000,
      explainabilityReport: { factors: [] },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("5000");
  });

  it("blocks AUTO_APPROVE when explainabilityReport is missing", () => {
    const result = checkGuardrails("AUTO_APPROVE", {
      fraudScore: 20,
      estimatedAmount: 1000,
      explainabilityReport: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("explicabilité");
  });

  it("allows AUTO_APPROVE when all guardrails pass", () => {
    const result = checkGuardrails("AUTO_APPROVE", {
      fraudScore: 20,
      estimatedAmount: 1000,
      explainabilityReport: { factors: [] },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows ESCALATE_TO_MANAGER always", () => {
    const result = checkGuardrails("ESCALATE_TO_MANAGER", {
      fraudScore: 99,
      estimatedAmount: 99999,
    });
    expect(result.allowed).toBe(true);
  });

  it("allows REQUEST_INFO always", () => {
    const result = checkGuardrails("REQUEST_INFO", {});
    expect(result.allowed).toBe(true);
  });

  it("allows FLAG_FRAUD always", () => {
    const result = checkGuardrails("FLAG_FRAUD", {});
    expect(result.allowed).toBe(true);
  });

  it("blocks AUTO_REJECT and returns not allowed with reason", () => {
    const result = checkGuardrails("AUTO_REJECT" as RuleAction, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("AUTO_REJECT");
  });

  it("allows AUTO_APPROVE when fraudScore is null", () => {
    const result = checkGuardrails("AUTO_APPROVE", {
      fraudScore: null,
      estimatedAmount: null,
      explainabilityReport: { factors: [] },
    });
    expect(result.allowed).toBe(true);
  });
});
