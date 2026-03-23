/**
 * Tests — POST/GET /api/claims/[id]/analyses/[analysisId]/contest
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIAnalysis: { findFirst: vi.fn() },
    aIContestation: { findMany: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/explainability-service", () => ({
  submitContestation: vi.fn(),
  getContestationsForAnalysis: vi.fn(),
}));

import { POST, GET } from "@/app/api/claims/[id]/analyses/[analysisId]/contest/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { submitContestation, getContestationsForAnalysis } from "@/lib/explainability-service";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type AIAnalysisReturn = ReturnType<typeof prisma.aIAnalysis.findFirst> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockAnalysis = {
  id: "analysis-1",
  claimId: "claim-1",
  type: "FRAUD_SCORING",
  outputData: "{}",
  tokensUsed: 100,
  durationMs: 200,
  model: "llama-3.3-70b-versatile",
  createdAt: new Date(),
};

const mockContestation = {
  id: "cont-1",
  analysisId: "analysis-1",
  reason: "Le score de fraude semble incorrect",
  status: "PENDING" as const,
  resolution: null,
  contestedBy: "user-1",
  resolvedBy: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
};

const makeParams = (id: string, analysisId: string) => ({
  params: Promise.resolve({ id, analysisId }),
});

// ─── POST /api/claims/[id]/analyses/[analysisId]/contest ─────────────────────

describe("POST /api/claims/[id]/analyses/[analysisId]/contest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.aIAnalysis.findFirst).mockResolvedValue(mockAnalysis as unknown as AIAnalysisReturn);
    vi.mocked(submitContestation).mockResolvedValue(mockContestation);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest", {
      method: "POST",
      body: JSON.stringify({ reason: "Le score de fraude semble incorrect" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when reason is too short (< 10 chars)", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest", {
      method: "POST",
      body: JSON.stringify({ reason: "court" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 when body is missing reason field", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when analysis not found for claim", async () => {
    vi.mocked(prisma.aIAnalysis.findFirst).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-999/contest", {
      method: "POST",
      body: JSON.stringify({ reason: "Le score de fraude semble incorrect" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, makeParams("claim-1", "analysis-999"));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("introuvable");
  });

  it("returns 201 with contestation data on success", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest", {
      method: "POST",
      body: JSON.stringify({ reason: "Le score de fraude semble incorrect pour ce type de sinistre" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.id).toBe("cont-1");
    expect(data.data.status).toBe("PENDING");
  });

  it("calls submitContestation with correct arguments", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest", {
      method: "POST",
      body: JSON.stringify({ reason: "Le score de fraude semble incorrect pour ce type de sinistre" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req, makeParams("claim-1", "analysis-1"));
    expect(submitContestation).toHaveBeenCalledWith(
      "analysis-1",
      "user-1",
      "Le score de fraude semble incorrect pour ce type de sinistre"
    );
  });
});

// ─── GET /api/claims/[id]/analyses/[analysisId]/contest ──────────────────────

describe("GET /api/claims/[id]/analyses/[analysisId]/contest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.aIAnalysis.findFirst).mockResolvedValue(mockAnalysis as unknown as AIAnalysisReturn);
    vi.mocked(getContestationsForAnalysis).mockResolvedValue([mockContestation]);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest");
    const res = await GET(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when analysis not found", async () => {
    vi.mocked(prisma.aIAnalysis.findFirst).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-999/contest");
    const res = await GET(req, makeParams("claim-1", "analysis-999"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with contestations list", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest");
    const res = await GET(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("cont-1");
  });

  it("returns 200 with empty array when no contestations", async () => {
    vi.mocked(getContestationsForAnalysis).mockResolvedValue([]);
    const req = new NextRequest("http://localhost/api/claims/claim-1/analyses/analysis-1/contest");
    const res = await GET(req, makeParams("claim-1", "analysis-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toEqual([]);
  });
});
