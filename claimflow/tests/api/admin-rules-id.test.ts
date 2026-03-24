/**
 * Tests — PATCH/DELETE /api/admin/rules/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRule: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH, DELETE } from "@/app/api/admin/rules/[id]/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type RuleFindReturn = ReturnType<typeof prisma.automationRule.findUnique> extends Promise<infer T> ? T : never;
type RuleUpdateReturn = ReturnType<typeof prisma.automationRule.update> extends Promise<infer T> ? T : never;
type RuleDeleteReturn = ReturnType<typeof prisma.automationRule.delete> extends Promise<infer T> ? T : never;

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
  description: "Approuver automatiquement les sinistres < 500€",
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
};

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// ─── PATCH /api/admin/rules/[id] ────────────────────────────────────────────

describe("PATCH /api/admin/rules/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(mockRule as unknown as RuleFindReturn);
    vi.mocked(prisma.automationRule.update).mockResolvedValue({
      ...mockRule,
      name: "Updated name",
    } as unknown as RuleUpdateReturn);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated name" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated name" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-999", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated name" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-999"));
    expect(res.status).toBe(404);
  });

  it("returns 422 when action is AUTO_REJECT", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "AUTO_REJECT" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-1"));
    // AUTO_REJECT not in Zod enum → 400, or if bypassed → 422
    expect([400, 422]).toContain(res.status);
  });

  it("updates rule successfully for MANAGER", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated name" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.name).toBe("Updated name");
  });

  it("updates rule successfully for ADMIN", async () => {
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated by admin" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, makeParams("rule-1"));
    expect(res.status).toBe(200);
  });

  it("creates audit log on update", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated name" }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, makeParams("rule-1"));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RULE_UPDATED",
        entityType: "AUTOMATION_RULE",
        entityId: "rule-1",
      })
    );
  });
});

// ─── DELETE /api/admin/rules/[id] ───────────────────────────────────────────

describe("DELETE /api/admin/rules/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(mockRule as unknown as RuleFindReturn);
    vi.mocked(prisma.automationRule.delete).mockResolvedValue(mockRule as unknown as RuleDeleteReturn);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("rule-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("rule-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for MANAGER role (ADMIN-only)", async () => {
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("rule-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/rules/rule-999", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("rule-999"));
    expect(res.status).toBe(404);
  });

  it("deletes rule and creates audit log", async () => {
    const req = new NextRequest("http://localhost/api/admin/rules/rule-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("rule-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.deleted).toBe(true);
    expect(prisma.automationRule.delete).toHaveBeenCalledWith({ where: { id: "rule-1" } });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RULE_DELETED",
        entityType: "AUTOMATION_RULE",
        entityId: "rule-1",
      })
    );
  });
});
