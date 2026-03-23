/**
 * Tests — GET/PATCH /api/admin/ai-providers
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIProviderConfig: {
      findMany: vi.fn(),
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

import { GET, PATCH } from "@/app/api/admin/ai-providers/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type ProviderFindManyReturn = ReturnType<typeof prisma.aIProviderConfig.findMany> extends Promise<infer T> ? T : never;
type ProviderFindUniqueReturn = ReturnType<typeof prisma.aIProviderConfig.findUnique> extends Promise<infer T> ? T : never;
type ProviderUpdateReturn = ReturnType<typeof prisma.aIProviderConfig.update> extends Promise<infer T> ? T : never;

const mockAdminSession = {
  user: { id: "admin-1", email: "admin@test.com", name: "Admin", role: "ADMIN" as const },
};

const mockManagerSession = {
  user: { id: "manager-1", email: "manager@test.com", name: "Manager", role: "MANAGER" as const },
};

const mockHandlerSession = {
  user: { id: "handler-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const mockGroqConfig = {
  id: "cfg-groq",
  provider: "GROQ",
  active: true,
  priority: 1,
  defaultModel: "llama-3.3-70b-versatile",
  maxTokens: 4096,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAnthropicConfig = {
  id: "cfg-anthropic",
  provider: "ANTHROPIC",
  active: false,
  priority: 2,
  defaultModel: "claude-sonnet-4-6",
  maxTokens: 4096,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── GET /api/admin/ai-providers ─────────────────────────────────────────────

describe("GET /api/admin/ai-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    vi.mocked(prisma.aIProviderConfig.findMany).mockResolvedValue(
      [mockGroqConfig, mockAnthropicConfig] as unknown as ProviderFindManyReturn
    );
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/ai-providers");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for MANAGER role (not ADMIN)", async () => {
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/ai-providers");
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 403 for HANDLER role", async () => {
    vi.mocked(auth).mockResolvedValue(mockHandlerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/ai-providers");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 with all provider configs for ADMIN", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(2);
    expect(data.data[0].provider).toBe("GROQ");
    expect(data.data[1].provider).toBe("ANTHROPIC");
  });

  it("returns active and inactive providers", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers");
    const res = await GET(req);
    const data = await res.json();
    const groq = data.data.find((c: { provider: string }) => c.provider === "GROQ");
    const anthropic = data.data.find((c: { provider: string }) => c.provider === "ANTHROPIC");
    expect(groq.active).toBe(true);
    expect(anthropic.active).toBe(false);
  });
});

// ─── PATCH /api/admin/ai-providers ───────────────────────────────────────────

describe("PATCH /api/admin/ai-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockAdminSession as unknown as AuthReturn);
    vi.mocked(prisma.aIProviderConfig.findUnique).mockResolvedValue(
      mockGroqConfig as unknown as ProviderFindUniqueReturn
    );
    vi.mocked(prisma.aIProviderConfig.update).mockResolvedValue({
      ...mockGroqConfig,
      active: false,
      priority: 99,
    } as unknown as ProviderUpdateReturn);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "GROQ", active: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN roles", async () => {
    vi.mocked(auth).mockResolvedValue(mockManagerSession as unknown as AuthReturn);
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "GROQ", active: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is invalid (missing provider)", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 404 when provider config not found", async () => {
    vi.mocked(prisma.aIProviderConfig.findUnique).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "UNKNOWN_PROVIDER", active: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("introuvable");
  });

  it("returns 200 with updated config on success", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "GROQ", active: false, priority: 99 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.provider).toBe("GROQ");
    expect(data.data.active).toBe(false);
    expect(data.data.priority).toBe(99);
  });

  it("calls aIProviderConfig.update with correct where clause", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "GROQ", active: false }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req);
    expect(prisma.aIProviderConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: "GROQ" },
        data: expect.objectContaining({ active: false }),
      })
    );
  });

  it("returns 400 when maxTokens exceeds limit (> 32768)", async () => {
    const req = new NextRequest("http://localhost/api/admin/ai-providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "GROQ", maxTokens: 99999 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });
});
