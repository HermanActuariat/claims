/**
 * Tests — lib/ocr-service.ts
 * Mock prisma + Groq SDK
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

// Mock Groq SDK — the module default export is the Groq class constructor.
// We capture the mock instance so we can control chat.completions.create.
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

// Also mock the prompts so the test does not depend on their implementation
vi.mock("@/lib/prompts/ocr", () => ({
  OCR_SYSTEM_PROMPT: "system prompt",
  ocrTextUserPrompt: vi.fn().mockReturnValue("user prompt"),
}));

import { extractTextFromImage } from "@/lib/ocr-service";
import { prisma } from "@/lib/prisma";

type DocumentReturn = ReturnType<typeof prisma.document.findUnique> extends Promise<infer T>
  ? T
  : never;
type DocumentUpdateReturn = ReturnType<typeof prisma.document.update> extends Promise<infer T>
  ? T
  : never;

const mockDocument = {
  id: "doc-1",
  filename: "accident.jpg",
  url: "https://example.com/accident.jpg",
  mimeType: "image/jpeg",
  size: 102400,
  ocrExtracted: false,
  ocrData: null,
  ocrConfidence: null,
  documentType: "PHOTO",
  claimId: "claim-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockGroqResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          text: "Texte extrait du document",
          fields: { date: "2026-01-15", lieu: "Paris" },
          confidence: 0.92,
          language: "fr",
        }),
      },
    },
  ],
  usage: {
    total_tokens: 350,
  },
};

describe("extractTextFromImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.document.findUnique).mockResolvedValue(
      mockDocument as unknown as DocumentReturn
    );
    vi.mocked(prisma.document.update).mockResolvedValue(
      { ...mockDocument, ocrExtracted: true } as unknown as DocumentUpdateReturn
    );
    mockCreate.mockResolvedValue(mockGroqResponse);
  });

  it("returns OCR result with correct fields on success", async () => {
    const { result, tokensUsed, durationMs } = await extractTextFromImage("doc-1");

    expect(result.text).toBe("Texte extrait du document");
    expect(result.fields).toEqual({ date: "2026-01-15", lieu: "Paris" });
    expect(result.confidence).toBe(0.92);
    expect(result.language).toBe("fr");
    expect(tokensUsed).toBe(350);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls prisma.document.findUnique with the given documentId", async () => {
    await extractTextFromImage("doc-1");
    expect(prisma.document.findUnique).toHaveBeenCalledWith({ where: { id: "doc-1" } });
  });

  it("updates document record with OCR result after extraction", async () => {
    await extractTextFromImage("doc-1");

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({
        ocrExtracted: true,
        ocrConfidence: 0.92,
      }),
    });
  });

  it("throws when document is not found", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    await expect(extractTextFromImage("missing-doc")).rejects.toThrow(
      "Document introuvable : missing-doc"
    );
  });

  it("uses defaults when Groq returns incomplete OcrResult", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
      usage: { total_tokens: 0 },
    });

    const { result } = await extractTextFromImage("doc-1");

    expect(result.text).toBe("");
    expect(result.fields).toEqual({});
    expect(result.confidence).toBe(0);
    expect(result.language).toBe("fr");
  });

  it("returns 0 tokens when usage is missing from Groq response", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ text: "ok", fields: {}, confidence: 0.5, language: "fr" }),
          },
        },
      ],
      // no usage field
    });

    const { tokensUsed } = await extractTextFromImage("doc-1");
    expect(tokensUsed).toBe(0);
  });
});
