/**
 * Tests — POST /api/ai/classify-document
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

vi.mock("@/lib/document-classifier", () => ({
  classifyDocument: vi.fn(),
}));

import { POST } from "@/app/api/ai/classify-document/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { classifyDocument } from "@/lib/document-classifier";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type DocumentReturn = ReturnType<typeof prisma.document.findUnique> extends Promise<infer T>
  ? T
  : never;

const mockSession = {
  user: { id: "user-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

const VALID_DOC_ID = "clxabcd1234567890abcdef01";

const mockDocument = {
  id: VALID_DOC_ID,
  filename: "facture_reparation.pdf",
  url: "https://example.com/facture.pdf",
  mimeType: "application/pdf",
  size: 204800,
  ocrExtracted: false,
  ocrData: null,
  ocrConfidence: null,
  documentType: null,
  claimId: "claim-1",
  claim: { id: "claim-1" },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockClassificationResult = {
  documentType: "INVOICE" as const,
  confidence: 0.9,
  reasoning: "Classification par heuristique (nom de fichier / type MIME)",
};

describe("POST /api/ai/classify-document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as unknown as AuthReturn);
    vi.mocked(prisma.document.findUnique).mockResolvedValue(
      mockDocument as unknown as DocumentReturn
    );
    vi.mocked(classifyDocument).mockResolvedValue(mockClassificationResult);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);

    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid body (missing documentId)", async () => {
    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when documentId is not a valid CUID", async () => {
    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: "invalid-id-format" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 404 when document is not found", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/introuvable/i);
  });

  it("returns 201 with classification result on success", async () => {
    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.documentType).toBe("INVOICE");
    expect(body.data.confidence).toBe(0.9);
    expect(body.data.reasoning).toBeDefined();
  });

  it("calls classifyDocument with the documentId", async () => {
    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    await POST(req);

    expect(classifyDocument).toHaveBeenCalledWith(VALID_DOC_ID);
  });

  it("returns 500 when classifyDocument throws", async () => {
    vi.mocked(classifyDocument).mockRejectedValue(new Error("Groq API error"));

    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({ documentId: VALID_DOC_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("accepts optional filename and mimeType fields in the body", async () => {
    const req = new NextRequest("http://localhost/api/ai/classify-document", {
      method: "POST",
      body: JSON.stringify({
        documentId: VALID_DOC_ID,
        filename: "facture.pdf",
        mimeType: "application/pdf",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
  });
});
