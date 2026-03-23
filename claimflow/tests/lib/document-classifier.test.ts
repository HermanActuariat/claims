/**
 * Tests — lib/document-classifier.ts
 * Heuristique de classification + fallback IA
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockCreate = vi.fn();
vi.mock("groq-sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

vi.mock("@/lib/prompts/classify-document", () => ({
  CLASSIFY_DOCUMENT_SYSTEM_PROMPT: "system prompt",
  classifyDocumentUserPrompt: vi.fn().mockReturnValue("user prompt"),
}));

import { classifyByHeuristic, classifyDocument } from "@/lib/document-classifier";
import { prisma } from "@/lib/prisma";

type DocumentReturn = ReturnType<typeof prisma.document.findUnique> extends Promise<infer T>
  ? T
  : never;
type DocumentUpdateReturn = ReturnType<typeof prisma.document.update> extends Promise<infer T>
  ? T
  : never;

// ─── classifyByHeuristic ──────────────────────────────────────────────────────

describe("classifyByHeuristic", () => {
  it('returns "ECONSTAT" for econstat.xml', () => {
    expect(classifyByHeuristic("econstat.xml", "application/xml")).toBe("ECONSTAT");
  });

  it('returns "ECONSTAT" for e-constat.json', () => {
    expect(classifyByHeuristic("e-constat.json", "application/json")).toBe("ECONSTAT");
  });

  it('returns "ECONSTAT" for constat_amiable.xml', () => {
    expect(classifyByHeuristic("constat_amiable.xml", "application/xml")).toBe("ECONSTAT");
  });

  it('returns "INVOICE" for facture.pdf', () => {
    expect(classifyByHeuristic("facture.pdf", "application/pdf")).toBe("INVOICE");
  });

  it('returns "INVOICE" for invoice_2026.pdf', () => {
    expect(classifyByHeuristic("invoice_2026.pdf", "application/pdf")).toBe("INVOICE");
  });

  it('returns "INVOICE" for devis_reparation.pdf', () => {
    expect(classifyByHeuristic("devis_reparation.pdf", "application/pdf")).toBe("INVOICE");
  });

  it('returns "PHOTO" for accident.jpg with image MIME type', () => {
    expect(classifyByHeuristic("accident.jpg", "image/jpeg")).toBe("PHOTO");
  });

  it('returns "PHOTO" for damage.png with image MIME type', () => {
    expect(classifyByHeuristic("damage.png", "image/png")).toBe("PHOTO");
  });

  it('returns "PHOTO" for unknown.webp by extension', () => {
    expect(classifyByHeuristic("unknown.webp", "application/octet-stream")).toBe("PHOTO");
  });

  it('returns "ID_CARD" for permis_conduire.png', () => {
    expect(classifyByHeuristic("permis_conduire.png", "image/png")).toBe("ID_CARD");
  });

  it('returns "INSURANCE_CARD" for carte_verte.jpg', () => {
    expect(classifyByHeuristic("carte_verte.jpg", "image/jpeg")).toBe("INSURANCE_CARD");
  });

  it('returns "POLICE_REPORT" for pv_gendarmerie.pdf', () => {
    expect(classifyByHeuristic("pv_gendarmerie.pdf", "application/pdf")).toBe("POLICE_REPORT");
  });

  it('returns "EXPERT_REPORT" for rapport_expertise.pdf', () => {
    expect(classifyByHeuristic("rapport_expertise.pdf", "application/pdf")).toBe("EXPERT_REPORT");
  });

  it("returns null for a generic unknown.pdf", () => {
    expect(classifyByHeuristic("unknown.pdf", "application/pdf")).toBeNull();
  });

  it("returns null for a completely unknown file type", () => {
    expect(classifyByHeuristic("data.bin", "application/octet-stream")).toBeNull();
  });
});

// ─── classifyDocument ─────────────────────────────────────────────────────────

describe("classifyDocument", () => {
  const mockDocument = {
    id: "doc-1",
    filename: "econstat.xml",
    mimeType: "application/xml",
    url: "https://example.com/econstat.xml",
    size: 2048,
    ocrExtracted: false,
    ocrData: null,
    ocrConfidence: null,
    documentType: null,
    claimId: "claim-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.document.findUnique).mockResolvedValue(
      mockDocument as unknown as DocumentReturn
    );
    vi.mocked(prisma.document.update).mockResolvedValue(
      mockDocument as unknown as DocumentUpdateReturn
    );
  });

  it("uses heuristic when the filename gives a clear classification", async () => {
    const result = await classifyDocument("doc-1");

    expect(result.documentType).toBe("ECONSTAT");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toMatch(/heuristique/i);
    // AI should NOT have been called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persists the classified documentType to the database", async () => {
    await classifyDocument("doc-1");

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { documentType: "ECONSTAT" },
    });
  });

  it("falls back to AI classification when heuristic returns null (generic PDF)", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      ...mockDocument,
      filename: "document_inconnu.pdf",
      mimeType: "application/pdf",
    } as unknown as DocumentReturn);

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              documentType: "POLICE_REPORT",
              confidence: 0.75,
              reasoning: "Contenu ressemblant à un procès-verbal",
            }),
          },
        },
      ],
    });

    const result = await classifyDocument("doc-1");

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.documentType).toBe("POLICE_REPORT");
    expect(result.confidence).toBe(0.75);
  });

  it("falls back to OTHER when AI returns an unrecognised documentType", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      ...mockDocument,
      filename: "mystery.pdf",
      mimeType: "application/pdf",
    } as unknown as DocumentReturn);

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              documentType: "UNKNOWN_TYPE",
              confidence: 0.3,
              reasoning: "Cannot determine",
            }),
          },
        },
      ],
    });

    const result = await classifyDocument("doc-1");
    expect(result.documentType).toBe("OTHER");
  });

  it("passes OCR text to AI when document has ocrExtracted=true", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      ...mockDocument,
      filename: "unknown.pdf",
      mimeType: "application/pdf",
      ocrExtracted: true,
      ocrData: JSON.stringify({ text: "Procès-verbal de gendarmerie..." }),
    } as unknown as DocumentReturn);

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              documentType: "POLICE_REPORT",
              confidence: 0.88,
              reasoning: "OCR content matches police report",
            }),
          },
        },
      ],
    });

    const result = await classifyDocument("doc-1");

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.documentType).toBe("POLICE_REPORT");
  });

  it("throws when document is not found", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    await expect(classifyDocument("missing-doc")).rejects.toThrow(
      "Document introuvable : missing-doc"
    );
  });
});
