/**
 * Tests — SRA Service business logic
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairReference: { findMany: vi.fn() },
    claim: { findUnique: vi.fn() },
    garageQuote: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/ai-provider", () => ({
  callWithFallback: vi.fn(),
}));

vi.mock("@/lib/ai-utils", () => ({
  parseAIResponse: vi.fn(),
}));

import {
  getRegionCoefficient,
  mapVehicleToSegment,
  computeBaremeEstimation,
} from "@/lib/sra-service";
import { prisma } from "@/lib/prisma";

// ─── getRegionCoefficient ────────────────────────────────────────────────────

describe("getRegionCoefficient", () => {
  it("returns correct coefficient for known department", () => {
    const factor = { "75": 1.15, "69": 1.05, "default": 1.0 };
    expect(getRegionCoefficient(factor, "75")).toBe(1.15);
    expect(getRegionCoefficient(factor, "69")).toBe(1.05);
  });

  it("returns default for unknown department", () => {
    const factor = { "75": 1.15, "default": 1.0 };
    expect(getRegionCoefficient(factor, "33")).toBe(1.0);
  });

  it("returns 1.0 when regionFactor is null", () => {
    expect(getRegionCoefficient(null, "75")).toBe(1.0);
  });

  it("returns 1.0 when no default key and unknown department", () => {
    const factor = { "75": 1.15 };
    expect(getRegionCoefficient(factor, "33")).toBe(1.0);
  });
});

// ─── mapVehicleToSegment ─────────────────────────────────────────────────────

describe("mapVehicleToSegment", () => {
  it("maps Renault Clio to CITY", () => {
    expect(mapVehicleToSegment("Renault", "Clio", 2020)).toBe("CITY");
  });

  it("maps BMW X5 to SUV", () => {
    expect(mapVehicleToSegment("BMW", "X5", 2022)).toBe("SUV");
  });

  it("maps Mercedes S-Class to PREMIUM", () => {
    expect(mapVehicleToSegment("Mercedes", "S-Class", 2023)).toBe("PREMIUM");
  });

  it("maps Renault Kangoo to UTILITY", () => {
    expect(mapVehicleToSegment("Renault", "Kangoo", 2021)).toBe("UTILITY");
  });

  it("defaults to SEDAN for unknown model", () => {
    expect(mapVehicleToSegment("Toyota", "Corolla", 2021)).toBe("SEDAN");
  });

  it("maps Peugeot 208 to CITY", () => {
    expect(mapVehicleToSegment("Peugeot", "208", 2022)).toBe("CITY");
  });

  it("maps Peugeot 3008 to SUV", () => {
    expect(mapVehicleToSegment("Peugeot", "3008", 2022)).toBe("SUV");
  });
});

// ─── computeBaremeEstimation ─────────────────────────────────────────────────

describe("computeBaremeEstimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when claim not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null as never);
    await expect(computeBaremeEstimation("unknown-id")).rejects.toThrow("Sinistre introuvable");
  });

  it("returns BAREME_INTERNE with correct calculation", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue({
      id: "claim-1",
      policyholder: {
        vehicleMake: "Renault",
        vehicleModel: "Clio",
        vehicleYear: 2020,
      },
      garageQuotes: [],
    } as never);

    vi.mocked(prisma.repairReference.findMany).mockResolvedValue([
      {
        id: "ref-1",
        category: "BODY",
        subcategory: "Pare-chocs",
        vehicleSegment: "CITY",
        avgPartCost: 300,
        avgLaborHours: 3,
        avgLaborRate: 55,
        source: "SRA_OBSERVATOIRE",
        regionFactor: null,
        validFrom: new Date("2025-01-01"),
        validUntil: null,
      },
    ] as never);

    const result = await computeBaremeEstimation("claim-1");

    expect(result.source).toBe("BAREME_INTERNE");
    expect(result.baremeEstimate).not.toBeNull();
    // 300 + (3 * 55) = 300 + 165 = 465
    expect(result.baremeEstimate!.total).toBe(465);
    expect(result.baremeEstimate!.breakdown.BODY).toBe(465);
    expect(result.garageQuoteTotal).toBeNull();
    expect(result.regionCoefficient).toBe(1.0);
  });

  it("applies region coefficient when department provided", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue({
      id: "claim-1",
      policyholder: {
        vehicleMake: "Peugeot",
        vehicleModel: "308",
        vehicleYear: 2021,
      },
      garageQuotes: [],
    } as never);

    vi.mocked(prisma.repairReference.findMany).mockResolvedValue([
      {
        id: "ref-1",
        category: "BODY",
        subcategory: "Pare-chocs",
        vehicleSegment: "SEDAN",
        avgPartCost: 500,
        avgLaborHours: 4,
        avgLaborRate: 60,
        source: "SRA_OBSERVATOIRE",
        regionFactor: JSON.stringify({ "75": 1.15, "default": 1.0 }),
        validFrom: new Date("2025-01-01"),
        validUntil: null,
      },
    ] as never);

    const result = await computeBaremeEstimation("claim-1", "75");

    expect(result.source).toBe("BAREME_INTERNE");
    // (500 + 4*60) * 1.15 = 740 * 1.15 = 851
    expect(result.baremeEstimate!.total).toBe(851);
    expect(result.regionCoefficient).toBe(1.15);
    expect(result.department).toBe("75");
  });

  it("returns COMBINED when garage quote exists", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue({
      id: "claim-1",
      policyholder: {
        vehicleMake: "Renault",
        vehicleModel: "Clio",
        vehicleYear: 2020,
      },
      garageQuotes: [
        {
          id: "quote-1",
          garageName: "Garage Test",
          totalAmount: 800,
          validatedById: "user-1",
          lines: [],
          createdAt: new Date(),
        },
      ],
    } as never);

    vi.mocked(prisma.repairReference.findMany).mockResolvedValue([
      {
        id: "ref-1",
        category: "BODY",
        subcategory: "Pare-chocs",
        vehicleSegment: "CITY",
        avgPartCost: 300,
        avgLaborHours: 3,
        avgLaborRate: 55,
        source: "SRA_OBSERVATOIRE",
        regionFactor: null,
        validFrom: new Date("2025-01-01"),
        validUntil: null,
      },
    ] as never);

    const result = await computeBaremeEstimation("claim-1");

    expect(result.source).toBe("COMBINED");
    expect(result.garageQuoteTotal).toBe(800);
    expect(result.garageName).toBe("Garage Test");
    expect(result.baremeEstimate).not.toBeNull();
  });
});
