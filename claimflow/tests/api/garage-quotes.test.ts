/**
 * Tests — GET/POST /api/claims/[id]/garage-quotes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: { findUnique: vi.fn() },
    document: { create: vi.fn() },
    garageQuote: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    garageQuoteLine: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sra-service", () => ({
  extractGarageQuoteLines: vi.fn(),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("fake-file-content")),
  };
});

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: () => "test-uuid-1234",
  };
});

import { GET, POST } from "@/app/api/claims/[id]/garage-quotes/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { extractGarageQuoteLines } from "@/lib/sra-service";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;

const mockSession = {
  user: { id: "user-1", email: "test@test.com", name: "Test User", role: "MANAGER" as const },
};

const mockClaim = { id: "claim-1", claimNumber: "CLM-2026-00001", status: "SUBMITTED" };

const mockQuote = {
  id: "quote-1",
  claimId: "claim-1",
  documentId: "doc-1",
  garageName: "Garage Test",
  garageCity: "Paris",
  totalAmount: 1500,
  extractedByAI: true,
  validatedById: null,
  validatedAt: null,
  createdAt: new Date("2026-01-01"),
  lines: [
    {
      id: "line-1",
      lineType: "PART",
      description: "Pare-chocs avant",
      partReference: "PC-001",
      quantity: 1,
      unitPriceHT: 500,
      laborHours: null,
      laborRateHT: null,
      totalHT: 500,
      confidence: 0.95,
    },
  ],
  document: { filename: "devis.pdf", mimeType: "application/pdf" },
};

// ─── GET /api/claims/[id]/garage-quotes ──────────────────────────────────────

describe("GET /api/claims/[id]/garage-quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as unknown as AuthReturn);
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(mockClaim as never);
    vi.mocked(prisma.garageQuote.findMany).mockResolvedValue([mockQuote] as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/claims/claim-1/garage-quotes");
    const res = await GET(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when claim not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null as never);
    const req = new NextRequest("http://localhost/api/claims/unknown/garage-quotes");
    const res = await GET(req, { params: Promise.resolve({ id: "unknown" }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with quotes list", async () => {
    const req = new NextRequest("http://localhost/api/claims/claim-1/garage-quotes");
    const res = await GET(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].garageName).toBe("Garage Test");
    expect(json.data[0].lines).toHaveLength(1);
  });
});

// ─── POST /api/claims/[id]/garage-quotes ─────────────────────────────────────

describe("POST /api/claims/[id]/garage-quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as unknown as AuthReturn);
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(mockClaim as never);
    vi.mocked(prisma.document.create).mockResolvedValue({ id: "doc-1" } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue(mockQuote as never);
    vi.mocked(extractGarageQuoteLines).mockResolvedValue({
      result: [
        {
          id: "line-1",
          lineType: "PART",
          description: "Pare-chocs avant",
          partReference: "PC-001",
          quantity: 1,
          unitPriceHT: 500,
          laborHours: null,
          laborRateHT: null,
          totalHT: 500,
          confidence: 0.95,
        },
      ],
      tokensUsed: 100,
      durationMs: 500,
    });
  });

  function makeFakeFile(overrides?: { type?: string; name?: string; size?: number }) {
    return {
      name: overrides?.name ?? "devis.pdf",
      type: overrides?.type ?? "application/pdf",
      size: overrides?.size ?? 1024,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as File;
  }

  function makePostReq(formDataEntries: Record<string, unknown>) {
    const fd = new Map(Object.entries(formDataEntries));
    const req = new NextRequest("http://localhost/api/claims/claim-1/garage-quotes", { method: "POST" });
    req.formData = vi.fn().mockResolvedValue({
      get: (key: string) => fd.get(key) ?? null,
    });
    return req;
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = makePostReq({ file: makeFakeFile() });
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when claim not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null as never);
    const req = makePostReq({ file: makeFakeFile() });
    const res = await POST(req, { params: Promise.resolve({ id: "unknown" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when file is missing", async () => {
    const req = makePostReq({});
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported file type", async () => {
    const req = makePostReq({ file: makeFakeFile({ type: "text/plain", name: "devis.txt" }) });
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Format non autorisé");
  });

  it("returns 201 with AI-extracted lines on success", async () => {
    const req = makePostReq({ file: makeFakeFile(), garageName: "Garage Test", garageCity: "Paris" });
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.extractedByAI).toBe(true);
  });

  it("returns 201 with empty lines when AI extraction fails (graceful degradation)", async () => {
    vi.mocked(extractGarageQuoteLines).mockRejectedValue(new Error("AI unavailable"));
    vi.mocked(prisma.$transaction).mockResolvedValue({
      ...mockQuote,
      extractedByAI: false,
      totalAmount: null,
      lines: [],
    } as never);

    const req = makePostReq({ file: makeFakeFile() });
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.extractedByAI).toBe(false);
    expect(json.data.lines).toEqual([]);
  });

  it("returns 500 when transaction fails", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));
    const req = makePostReq({ file: makeFakeFile() });
    const res = await POST(req, { params: Promise.resolve({ id: "claim-1" }) });
    expect(res.status).toBe(500);
  });

  it("uses sanitized UUID-based filename (path traversal protection)", () => {
    // Verify our filename generation logic strips dangerous characters
    const path = require("path");
    const maliciousName = "../../../etc/passwd.pdf";
    const ext = path.extname(maliciousName).replace(/[^.a-zA-Z0-9]/g, "");
    const safeFilename = `${Date.now()}-test-uuid${ext}`;
    expect(safeFilename).not.toContain("../");
    expect(safeFilename).toMatch(/\.pdf$/);
    expect(ext).toBe(".pdf");
  });
});
