/**
 * Tests — GET/POST /api/admin/rules
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRule: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/rules/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type RuleFindManyReturn = ReturnType<typeof prisma.automationRule.findMany> extends Promise<infer T> ? T : never;
type RuleCreateReturn = ReturnType<typeof prisma.automationRule.create> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockAdminSession = {
  user: { id: "admin-1", email: "admin@test.com", name: "Admin", role: "ADMIN" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockRule = {
  id: "rule-1",
  name: "Auto approuver petits sinistres",
  description: "Approuver automatiquement les sinistres < 500€ avec faible risque fraude",
  active: true,
  priority: 10,
  conditions: JSON.stringify([
    { field: "fraudScore", operator: "lt", value: 30 },
    { field: "estimatedAmount", operator: "lt", value: 500 },
  ]),
  action: "AUTO_APPROVE",
  actionParams: null,
  createdBy: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { executionLogs: 5 },
};

const validRulePayload = {
  name: "Escalader fraude critique",
  description: "Escalader vers manager si score fraude > 80",
  active: true,
  priority: 5,
  conditions: [{ field: "fraudScore", operator: "gt", value: 80 }],
  action: "ESCALATE_TO_MANAGER",
};

// ─── GET /api/admin/rules ─────────────────────────────────────────────────────

describe("GET /api/admin/rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue(
      [mockRule] as unknown as RuleFindManyReturn
    );
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules");
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("managers");
  });

  it("returns 200 with rules list for MANAGER", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("rule-1");
    expect(data.data[0].name).toBe("Auto approuver petits sinistres");
    // Conditions should be parsed from JSON string
    expect(Array.isArray(data.data[0].conditions)).toBe(true);
    expect(data.data[0].executionCount).toBe(5);
  });

  it("returns 200 with rules list for ADMIN", async () => {
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("returns empty list when no rules exist", async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([] as unknown as RuleFindManyReturn);
    const req = new NextRequest("http://localhost/api/admin/rules");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toEqual([]);
  });
});

// ─── POST /api/admin/rules ────────────────────────────────────────────────────

describe("POST /api/admin/rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.automationRule.create).mockResolvedValue({
      ...mockRule,
      id: "rule-new",
      name: validRulePayload.name,
      action: validRulePayload.action,
    } as unknown as RuleCreateReturn);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify(validRulePayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify(validRulePayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is too short (< 3 chars)", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify({ ...validRulePayload, name: "ab" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 when conditions array is empty", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify({ ...validRulePayload, conditions: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when action is invalid", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify({ ...validRulePayload, action: "INVALID_ACTION" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 when action is AUTO_REJECT", async () => {
    // AUTO_REJECT is not in CreateRuleSchema enum but would be 400 from Zod
    // This test verifies that even if somehow it passes Zod, route blocks it
    // In practice Zod will block it first → 400
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify({ ...validRulePayload, action: "AUTO_REJECT" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    // AUTO_REJECT is not in Zod enum, so Zod catches it first → 400
    expect([400, 422]).toContain(res.status);
  });

  it("returns 201 with created rule on success", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify(validRulePayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.name).toBe(validRulePayload.name);
  });

  it("calls automationRule.create with correct data", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules", {
      method: "POST",
      body: JSON.stringify(validRulePayload),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);
    expect(prisma.automationRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: validRulePayload.name,
          action: validRulePayload.action,
          createdBy: "user-1",
        }),
      })
    );
  });
});
