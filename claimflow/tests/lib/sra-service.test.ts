/**
 * Tests — src/lib/sra-service.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairReference: {
      findMany: vi.fn(),
    },
    garageQuote: {
      findMany: vi.fn(),
    },
    claim: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai-provider", () => ({
  callWithFallback: vi.fn(),
}));

vi.mock("@/lib/ai-utils", () => ({
  parseAIResponse: vi.fn((text: string) => JSON.parse(text)),
}));

import { prisma } from "@/lib/prisma";
import { callWithFallback } from "@/lib/ai-provider";
import {
  getRepairReferences,
  getRegionalCoefficient,
  computeSRAEstimation,
  extractGarageQuoteLines,
} from "@/lib/sra-service";

describe("sra-service", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getRepairReferences", () => {
    it("returns entries filtered by category and active dates", async () => {
      const mockRefs = [
        { id: "ref1", category: "BODY", vehicleSegment: "CITY", avgPartCost: 250, avgLaborHours: 3, avgLaborRate: 55, regionFactor: null, validFrom: new Date("2026-01-01"), validUntil: null },
      ];
      vi.mocked(prisma.repairReference.findMany).mockResolvedValue(mockRefs as never);

      const result = await getRepairReferences("BODY");

      expect(prisma.repairReference.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: "BODY" }),
        })
      );
      expect(result).toEqual(mockRefs);
    });
  });

  describe("getRegionalCoefficient", () => {
    it("returns correct coefficient for known department", () => {
      const regionFactor = JSON.stringify({ "75": 1.15, "69": 1.05, "default": 1.0 });
      expect(getRegionalCoefficient(regionFactor, "75")).toBe(1.15);
    });

    it("returns default (1.0) for unknown department", () => {
      const regionFactor = JSON.stringify({ "75": 1.15, "default": 1.0 });
      expect(getRegionalCoefficient(regionFactor, "33")).toBe(1.0);
    });

    it("returns 1.0 when regionFactor is null", () => {
      expect(getRegionalCoefficient(null, "75")).toBe(1.0);
    });
  });

  describe("computeSRAEstimation", () => {
    const mockClaim = {
      id: "claim1",
      type: "COLLISION",
      incidentZipCode: "75001",
      policyholder: { vehicleMake: "Renault", vehicleModel: "Clio" },
    };

    it("computes correct total from bareme entries", async () => {
      vi.mocked(prisma.claim.findUnique).mockResolvedValue(mockClaim as never);
      vi.mocked(prisma.repairReference.findMany).mockResolvedValue([
        {
          id: "ref1", category: "BODY", avgPartCost: 250, avgLaborHours: 3, avgLaborRate: 55,
          regionFactor: JSON.stringify({ "75": 1.15, "default": 1.0 }),
          validFrom: new Date("2026-01-01"), validUntil: null, vehicleSegment: "CITY",
        },
      ] as never);
      vi.mocked(prisma.garageQuote.findMany).mockResolvedValue([] as never);

      const result = await computeSRAEstimation("claim1");

      expect(result.source).toBe("BAREME_INTERNE");
      expect(result.confidence).toBe("medium");
      expect(result.regionalCoefficient).toBe(1.15);
      // parts=250*1.15=287.5, labor=3*55*1.15=189.75 → total=477.25
      expect(result.estimatedTotal).toBeCloseTo(477.25, 1);
    });

    it("uses garage quote when available", async () => {
      vi.mocked(prisma.claim.findUnique).mockResolvedValue(mockClaim as never);
      vi.mocked(prisma.repairReference.findMany).mockResolvedValue([
        {
          id: "ref1", category: "BODY", avgPartCost: 250, avgLaborHours: 3, avgLaborRate: 55,
          regionFactor: JSON.stringify({ "75": 1.15, "default": 1.0 }),
          validFrom: new Date("2026-01-01"), validUntil: null, vehicleSegment: "CITY",
        },
      ] as never);
      vi.mocked(prisma.garageQuote.findMany).mockResolvedValue([
        {
          id: "quote1",
          lines: [
            { lineType: "PART", totalHT: 300 },
            { lineType: "LABOR", totalHT: 200 },
          ],
          validatedAt: new Date(),
        },
      ] as never);

      const result = await computeSRAEstimation("claim1");

      expect(result.source).toBe("MIXTE");
      expect(result.confidence).toBe("high");
    });
  });

  describe("extractGarageQuoteLines", () => {
    it("calls callWithFallback and returns parsed lines", async () => {
      const mockResponse = {
        garageName: "Garage Test",
        garageCity: "Paris",
        totalAmount: 500,
        lines: [
          { lineType: "PART", description: "Pare-chocs", partReference: "REF123", quantity: 1, unitPriceHT: 300, laborHours: null, laborRateHT: null, totalHT: 300, confidence: 0.95 },
          { lineType: "LABOR", description: "Main d'oeuvre", partReference: null, quantity: 1, unitPriceHT: 200, laborHours: 3, laborRateHT: 65, totalHT: 200, confidence: 0.9 },
        ],
      };
      vi.mocked(callWithFallback).mockResolvedValue({
        text: JSON.stringify(mockResponse),
        tokensUsed: 100,
        durationMs: 500,
      } as never);

      const result = await extractGarageQuoteLines("Contenu du devis...");

      expect(callWithFallback).toHaveBeenCalled();
      expect(result.garageName).toBe("Garage Test");
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].lineType).toBe("PART");
    });
  });
});
