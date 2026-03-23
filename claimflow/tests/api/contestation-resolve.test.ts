/**
 * Tests — PATCH /api/claims/[id]/analyses/[analysisId]/contest/[contestId]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIContestation: { findFirst: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/explainability-service", () => ({
  resolveContestation: vi.fn(),
}));

import { PATCH } from "@/app/api/claims/[id]/analyses/[analysisId]/contest/[contestId]/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolveContestation } from "@/lib/explainability-service";
import { createAuditLog } from "@/lib/audit";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type ContestationFindReturn = ReturnType<typeof prisma.aIContestation.findFirst> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockAdminSession = {
  user: { id: "admin-1", email: "admin@test.com", name: "Admin", role: "ADMIN" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockPendingContestation = {
  id: "cont-1",
  analysisId: "analysis-1",
  reason: "Le score de fraude semble incorrect",
  status: "PENDING",
  resolution: null,
  contestedBy: "user-2",
  resolvedBy: null,
  createdAt: new Date(),
  resolvedAt: null,
};

const mockResolvedContestation = {
  ...mockPendingContestation,
  status: "ACCEPTED",
};

const mockResolvedResult = {
  id: "cont-1",
  analysisId: "analysis-1",
  reason: "Le score de fraude semble incorrect",
  status: "ACCEPTED" as const,
  resolution: "Score réévalué après vérification manuelle",
  contestedBy: "user-2",
  resolvedBy: "user-1",
  createdAt: new Date().toISOString(),
  resolvedAt: new Date().toISOString(),
};

const makeParams = (id: string, analysisId: string, contestId: string) => ({
  params: Promise.resolve({ id, analysisId, contestId }),
});

const makeRequest = (body: unknown) =>
  new NextRequest(
    "http://localhost/api/claims/claim-1/analyses/analysis-1/contest/cont-1",
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );

describe("PATCH /api/claims/[id]/analyses/[analysisId]/contest/[contestId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.aIContestation.findFirst).mockResolvedValue(
      mockPendingContestation as unknown as ContestationFindReturn
    );
    vi.mocked(resolveContestation).mockResolvedValue(mockResolvedResult);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when HANDLER tries to resolve", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to resolve", async () => {
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid body (missing resolution)", async () => {
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (resolution too short)", async () => {
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "court" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await PATCH(
      makeRequest({ status: "INVALID", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when contestation not found", async () => {
    vi.mocked(prisma.aIContestation.findFirst).mockResolvedValue(null);
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-999")
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("introuvable");
  });

  it("returns 409 when contestation is not PENDING", async () => {
    vi.mocked(prisma.aIContestation.findFirst).mockResolvedValue(
      mockResolvedContestation as unknown as ContestationFindReturn
    );
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("déjà été traitée");
  });

  it("resolves contestation as ACCEPTED successfully", async () => {
    const res = await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.status).toBe("ACCEPTED");
    expect(resolveContestation).toHaveBeenCalledWith(
      "cont-1",
      "user-1",
      "ACCEPTED",
      "Score réévalué après vérification manuelle"
    );
  });

  it("resolves contestation as REJECTED successfully", async () => {
    vi.mocked(resolveContestation).mockResolvedValue({
      ...mockResolvedResult,
      status: "REJECTED" as const,
    });
    const res = await PATCH(
      makeRequest({ status: "REJECTED", resolution: "Le score initial est correct après vérification" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toBeDefined();
  });

  it("creates audit log on successful resolution", async () => {
    await PATCH(
      makeRequest({ status: "ACCEPTED", resolution: "Score réévalué après vérification manuelle" }),
      makeParams("claim-1", "analysis-1", "cont-1")
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CONTESTATION_RESOLVED",
        entityType: "AI_ANALYSIS",
        entityId: "analysis-1",
      })
    );
  });
});
