/**
 * Tests — src/lib/explainability-service.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIContestation: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    aIAnalysis: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import {
  generateExplainabilityReport,
  submitContestation,
  resolveContestation,
  getContestationsForAnalysis,
} from "@/lib/explainability-service";
import { prisma } from "@/lib/prisma";

// ─── generateExplainabilityReport ────────────────────────────────────────────

describe("generateExplainabilityReport — FRAUD_SCORING", () => {
  it("returns factors with methodology for fraud type", async () => {
    const inputData = { thirdPartyInvolved: false, documentCount: 2 };
    const outputData = {
      score: 70,
      risk: "HIGH",
      summary: "Risque élevé",
      recommendation: "Enquêter",
      factors: [
        { name: "Déclaration tardive", description: "Délai anormal", weight: 0.6, detected: true },
        { name: "Historique propre", description: "Aucun antécédent", weight: 0.2, detected: false },
      ],
    };

    const report = await generateExplainabilityReport("FRAUD_SCORING", inputData, outputData);

    expect(report.methodology).toContain("score de fraude");
    expect(report.factors).toHaveLength(2);
    expect(report.factors[0].name).toBe("Déclaration tardive");
    expect(report.factors[0].impact).toBe("negative");
    expect(report.factors[1].impact).toBe("positive");
    expect(report.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(report.confidenceScore).toBeLessThanOrEqual(1);
    expect(report.dataSourcesUsed.length).toBeGreaterThan(0);
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it("adds neutral factor when thirdPartyInvolved is true", async () => {
    const inputData = { thirdPartyInvolved: true, documentCount: 1 };
    const outputData = { score: 20, risk: "LOW", factors: [] };

    const report = await generateExplainabilityReport("FRAUD_SCORING", inputData, outputData);
    const thirdPartyFactor = report.factors.find((f) => f.name === "Tiers impliqué");
    expect(thirdPartyFactor).toBeDefined();
    expect(thirdPartyFactor?.impact).toBe("neutral");
  });

  it("adds negative factor when documentCount is 0", async () => {
    const inputData = { thirdPartyInvolved: false, documentCount: 0 };
    const outputData = { score: 30, risk: "LOW", factors: [] };

    const report = await generateExplainabilityReport("FRAUD_SCORING", inputData, outputData);
    const noDocFactor = report.factors.find((f) => f.name === "Absence de documents");
    expect(noDocFactor).toBeDefined();
    expect(noDocFactor?.impact).toBe("negative");
  });
});

describe("generateExplainabilityReport — ESTIMATION", () => {
  it("returns breakdown factors for estimation type", async () => {
    const inputData = { type: "COLLISION" };
    const outputData = {
      estimatedTotal: 3000,
      min: 2500,
      max: 3500,
      breakdown: { parts: 1800, labor: 900, other: 300 },
      franchise: 300,
      netEstimate: 2700,
      confidence: "high",
    };

    const report = await generateExplainabilityReport("ESTIMATION", inputData, outputData);

    expect(report.factors.some((f) => f.name === "Coût des pièces")).toBe(true);
    expect(report.factors.some((f) => f.name === "Main d'oeuvre")).toBe(true);
    expect(report.factors.some((f) => f.name === "Frais annexes")).toBe(true);
    expect(report.factors.some((f) => f.name === "Franchise contractuelle")).toBe(true);
    expect(report.factors.some((f) => f.name === "Type de sinistre")).toBe(true);
    expect(report.confidenceScore).toBe(0.85);
    expect(report.methodology).toContain("indemnisation");
  });

  it("maps confidence low to 0.4 and medium to 0.65", async () => {
    const base = { type: "THEFT" };
    const outputLow = { estimatedTotal: 1000, breakdown: { parts: 0, labor: 0, other: 0 }, confidence: "low", franchise: 0 };
    const outputMedium = { ...outputLow, confidence: "medium" };

    const reportLow = await generateExplainabilityReport("ESTIMATION", base, outputLow);
    const reportMedium = await generateExplainabilityReport("ESTIMATION", base, outputMedium);

    expect(reportLow.confidenceScore).toBe(0.4);
    expect(reportMedium.confidenceScore).toBe(0.65);
  });
});

describe("generateExplainabilityReport — fallback (EXTRACTION)", () => {
  it("returns generic factor with neutral impact for unknown type", async () => {
    const report = await generateExplainabilityReport("EXTRACTION", {}, {});

    expect(report.factors).toHaveLength(1);
    expect(report.factors[0].impact).toBe("neutral");
    expect(report.confidenceScore).toBe(0.7);
    expect(report.methodology).toContain("EXTRACTION");
  });
});

// ─── submitContestation ───────────────────────────────────────────────────────

describe("submitContestation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a contestation record and returns ContestationItem", async () => {
    const now = new Date();
    const mockRecord = {
      id: "cont-1",
      analysisId: "analysis-1",
      reason: "Le score semble erroné",
      status: "PENDING",
      resolution: null,
      contestedBy: "user-1",
      resolvedBy: null,
      createdAt: now,
      resolvedAt: null,
    };

    vi.mocked(prisma.aIContestation.create).mockResolvedValue(mockRecord as never);

    const result = await submitContestation("analysis-1", "user-1", "Le score semble erroné");

    expect(prisma.aIContestation.create).toHaveBeenCalledWith({
      data: {
        analysisId: "analysis-1",
        reason: "Le score semble erroné",
        status: "PENDING",
        contestedBy: "user-1",
      },
    });
    expect(result.id).toBe("cont-1");
    expect(result.status).toBe("PENDING");
    expect(result.resolution).toBeNull();
    expect(result.createdAt).toBe(now.toISOString());
    expect(result.resolvedAt).toBeNull();
  });
});

// ─── resolveContestation ──────────────────────────────────────────────────────

describe("resolveContestation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates contestation with ACCEPTED status and resolution", async () => {
    const now = new Date();
    const resolvedAt = new Date();
    const mockRecord = {
      id: "cont-1",
      analysisId: "analysis-1",
      reason: "Motif original",
      status: "ACCEPTED",
      resolution: "Après vérification, le score est corrigé",
      contestedBy: "user-1",
      resolvedBy: "manager-1",
      createdAt: now,
      resolvedAt,
    };

    vi.mocked(prisma.aIContestation.update).mockResolvedValue(mockRecord as never);
    vi.mocked(prisma.aIAnalysis.findUnique).mockResolvedValue(null as never);

    const result = await resolveContestation(
      "cont-1",
      "manager-1",
      "ACCEPTED",
      "Après vérification, le score est corrigé"
    );

    expect(prisma.aIContestation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cont-1" },
        data: expect.objectContaining({
          status: "ACCEPTED",
          resolution: "Après vérification, le score est corrigé",
          resolvedBy: "manager-1",
        }),
      })
    );
    expect(result.status).toBe("ACCEPTED");
    expect(result.resolvedBy).toBe("manager-1");
    expect(result.resolvedAt).toBe(resolvedAt.toISOString());
  });

  it("updates contestation with REJECTED status", async () => {
    const now = new Date();
    const resolvedAt = new Date();
    const mockRecord = {
      id: "cont-2",
      analysisId: "analysis-2",
      reason: "Motif",
      status: "REJECTED",
      resolution: "Non fondé",
      contestedBy: "user-2",
      resolvedBy: "manager-1",
      createdAt: now,
      resolvedAt,
    };

    vi.mocked(prisma.aIContestation.update).mockResolvedValue(mockRecord as never);

    const result = await resolveContestation("cont-2", "manager-1", "REJECTED", "Non fondé");

    expect(result.status).toBe("REJECTED");
  });
});

// ─── getContestationsForAnalysis ──────────────────────────────────────────────

describe("getContestationsForAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of contestations for an analysis", async () => {
    const now = new Date();
    const mockRecords = [
      {
        id: "cont-1",
        analysisId: "analysis-1",
        reason: "Premier motif",
        status: "PENDING",
        resolution: null,
        contestedBy: "user-1",
        resolvedBy: null,
        createdAt: now,
        resolvedAt: null,
      },
      {
        id: "cont-2",
        analysisId: "analysis-1",
        reason: "Deuxième motif",
        status: "ACCEPTED",
        resolution: "Corrigé",
        contestedBy: "user-2",
        resolvedBy: "manager-1",
        createdAt: now,
        resolvedAt: now,
      },
    ];

    vi.mocked(prisma.aIContestation.findMany).mockResolvedValue(mockRecords as never);

    const results = await getContestationsForAnalysis("analysis-1");

    expect(prisma.aIContestation.findMany).toHaveBeenCalledWith({
      where: { analysisId: "analysis-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("cont-1");
    expect(results[1].status).toBe("ACCEPTED");
    expect(results[1].resolvedAt).toBe(now.toISOString());
  });

  it("returns empty array when no contestations exist", async () => {
    vi.mocked(prisma.aIContestation.findMany).mockResolvedValue([]);

    const results = await getContestationsForAnalysis("analysis-no-contest");
    expect(results).toEqual([]);
  });
});
