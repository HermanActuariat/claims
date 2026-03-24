/**
 * Tests — POST /api/ai/ocr
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ocr-service", () => ({
  extractTextFromImage: vi.fn(),
}));

import { POST } from "@/app/api/ai/ocr/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { extractTextFromImage } from "@/lib/ocr-service";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type DocumentReturn = ReturnType<typeof prisma.document.findUnique> extends Promise<infer T>
  ? T
  : never;

const mockSession = {
  user: { id: "user-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

// A valid CUID-shaped ID
const VALID_DOC_ID = "clxabcd1234567890abcdef01";

const mockDocument = {
  id: VALID_DOC_ID,
  filename: "accident.jpg",
  url: "https://example.com/accident.jpg",
  mimeType: "image/jpeg",
  size: 102400,
  ocrExtracted: false,
  ocrData: null,
  ocrConfidence: null,
  documentType: "PHOTO",
  claimId: "claim-1",
  claim: { id: "claim-1" },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOcrResult = {
  result: {
    text: "Texte extrait",
    fields: { date: "2026-01-15" },
    confidence: 0.9,
    language: "fr",
  },
  tokensUsed: 300,
  durationMs: 450,
};

describe("POST /api/ai/ocr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as unknown as AuthReturn);
    vi.mocked(prisma.document.findUnique).mockResolvedValue(
      mockDocument as unknown as DocumentReturn
    );
    vi.mocked(extractTextFromImage).mockResolvedValue(mockOcrResult);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);

    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid body (missing documentId)", async () => {
    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when documentId is not a valid CUID", async () => {
    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: "not-a-cuid" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 404 when document is not found", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/introuvable/i);
  });

  it("returns 201 with OCR result on success", async () => {
    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.text).toBe("Texte extrait");
    expect(body.data.confidence).toBe(0.9);
    expect(body.data.language).toBe("fr");
  });

  it("calls extractTextFromImage with the documentId", async () => {
    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    await POST(req);

    expect(extractTextFromImage).toHaveBeenCalledWith(VALID_DOC_ID);
  });

  it("returns 500 when extractTextFromImage throws", async () => {
    vi.mocked(extractTextFromImage).mockRejectedValue(new Error("Groq API error"));

    const req = new NextRequest("http://localhost/api/ai/ocr", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
