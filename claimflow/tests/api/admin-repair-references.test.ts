/**
 * Tests — GET/POST /api/admin/repair-references
 *         PATCH /api/admin/repair-references/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairReference: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/repair-references/route";
import { PATCH } from "@/app/api/admin/repair-references/[id]/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;

const mockManagerSession = {
  user: { id: "user-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockRef = {
  id: "ref-1",
  category: "BODY",
  subcategory: "Pare-chocs avant",
  vehicleSegment: "SEDAN",
  avgPartCost: 500,
  avgLaborHours: 4,
  avgLaborRate: 60,
  source: "SRA_OBSERVATOIRE",
  regionFactor: JSON.stringify({ "75": 1.15, "default": 1.0 }),
  validFrom: new Date("2025-01-01"),
  validUntil: null,
  updatedById: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validPayload = {
  category: "BODY",
  subcategory: "Pare-chocs avant",
  vehicleSegment: "SEDAN",
  avgPartCost: 500,
  avgLaborHours: 4,
  avgLaborRate: 60,
  source: "MANUAL",
  validFrom: "2025-01-01",
};

// ─── GET /api/admin/repair-references ────────────────────────────────────────

describe("GET /api/admin/repair-references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.repairReference.count).mockResolvedValue(1);
    vi.mocked(prisma.repairReference.findMany).mockResolvedValue([mockRef] as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/repair-references");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/repair-references");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 with repair references for MANAGER", async () => {
    const req = new NextRequest("http://localhost/api/admin/repair-references");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].category).toBe("BODY");
    expect(data.data[0].regionFactor).toEqual({ "75": 1.15, "default": 1.0 });
    expect(data.total).toBe(1);
  });

  it("returns empty list when no references exist", async () => {
    vi.mocked(prisma.repairReference.count).mockResolvedValue(0);
    vi.mocked(prisma.repairReference.findMany).mockResolvedValue([] as never);
    const req = new NextRequest("http://localhost/api/admin/repair-references");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toEqual([]);
  });
});

// ─── POST /api/admin/repair-references ───────────────────────────────────────

describe("POST /api/admin/repair-references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.repairReference.create).mockResolvedValue(mockRef as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/repair-references", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/repair-references", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when subcategory is too short", async () => {
    const req = new NextRequest("http://localhost/api/admin/repair-references", {
      method: "POST",
      body: JSON.stringify({ ...validPayload, subcategory: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when category is invalid", async () => {
    const req = new NextRequest("http://localhost/api/admin/repair-references", {
      method: "POST",
      body: JSON.stringify({ ...validPayload, category: "INVALID" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 201 with created reference on success", async () => {
    const req = new NextRequest("http://localhost/api/admin/repair-references", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.category).toBe("BODY");
  });
});

// ─── PATCH /api/admin/repair-references/[id] ─────────────────────────────────

describe("PATCH /api/admin/repair-references/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    vi.mocked(prisma.repairReference.findUnique).mockResolvedValue(mockRef as never);
    vi.mocked(prisma.repairReference.update).mockResolvedValue({ ...mockRef, avgPartCost: 600 } as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/repair-references/ref-1", {
      method: "PATCH",
      body: JSON.stringify({ avgPartCost: 600 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "ref-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when reference not found", async () => {
    vi.mocked(prisma.repairReference.findUnique).mockResolvedValue(null as never);
    const req = new NextRequest("http://localhost/api/admin/repair-references/ref-999", {
      method: "PATCH",
      body: JSON.stringify({ avgPartCost: 600 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "ref-999" }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with updated reference on success", async () => {
    const req = new NextRequest("http://localhost/api/admin/repair-references/ref-1", {
      method: "PATCH",
      body: JSON.stringify({ avgPartCost: 600 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "ref-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.avgPartCost).toBe(600);
  });
});
