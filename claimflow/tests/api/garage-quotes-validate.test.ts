/**
 * Tests — PATCH /api/claims/[id]/garage-quotes/[quoteId]/validate
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: { findUnique: vi.fn() },
    garageQuote: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "@/app/api/claims/[id]/garage-quotes/[quoteId]/validate/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockClaim = { id: "claim-1" };

const mockQuote = {
  id: "quote-1",
  claimId: "claim-1",
  validatedById: null,
};

const mockValidatedQuote = {
  id: "quote-1",
  claimId: "claim-1",
  documentId: "doc-1",
  garageName: "Garage Test",
  garageCity: "Paris",
  totalAmount: 1500,
  extractedByAI: true,
  validatedById: "user-1",
  validatedAt: new Date("2026-01-15"),
  createdAt: new Date("2026-01-01"),
  lines: [],
};

describe("PATCH /api/claims/[id]/garage-quotes/[quoteId]/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(mockClaim as never);
    vi.mocked(prisma.garageQuote.findFirst).mockResolvedValue(mockQuote as never);
    vi.mocked(prisma.garageQuote.update).mockResolvedValue(mockValidatedQuote as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "quote-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "quote-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when claim not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null as never);
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "unknown", quoteId: "quote-1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when quote not found", async () => {
    vi.mocked(prisma.garageQuote.findFirst).mockResolvedValue(null as never);
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "unknown" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid body", async () => {
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: "not-a-boolean" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "quote-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 200 on validation success", async () => {
    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "quote-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.validatedById).toBe("user-1");
  });

  it("returns 200 on invalidation (validated: false)", async () => {
    vi.mocked(prisma.garageQuote.update).mockResolvedValue({
      ...mockValidatedQuote,
      validatedById: null,
      validatedAt: null,
    } as never);

    const req = new NextRequest("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ validated: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "claim-1", quoteId: "quote-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.validatedById).toBeNull();
  });
});
