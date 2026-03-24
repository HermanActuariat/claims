import { describe, it, expect } from "vitest";
import {
  getProbabilityResolution,
  computeBestEstimate,
  computeSCR,
  computeRiskMargin,
} from "@/lib/solvency-service";

describe("getProbabilityResolution", () => {
  it("returns 0.55 for SUBMITTED", () => {
    expect(getProbabilityResolution("SUBMITTED")).toBe(0.55);
  });

  it("returns 0.70 for UNDER_REVIEW", () => {
    expect(getProbabilityResolution("UNDER_REVIEW")).toBe(0.70);
  });

  it("returns 0.65 for INFO_REQUESTED", () => {
    expect(getProbabilityResolution("INFO_REQUESTED")).toBe(0.65);
  });

  it("returns 0.95 for APPROVED", () => {
    expect(getProbabilityResolution("APPROVED")).toBe(0.95);
  });

  it("returns 0.02 for REJECTED", () => {
    expect(getProbabilityResolution("REJECTED")).toBe(0.02);
  });

  it("returns 0.98 for CLOSED", () => {
    expect(getProbabilityResolution("CLOSED")).toBe(0.98);
  });

  it("returns default 0.60 for unknown status", () => {
    expect(getProbabilityResolution("UNKNOWN_STATUS")).toBe(0.60);
  });

  it("returns default 0.60 for empty string", () => {
    expect(getProbabilityResolution("")).toBe(0.60);
  });

  it("ignores optional claimType parameter", () => {
    expect(getProbabilityResolution("SUBMITTED", "AUTO")).toBe(0.55);
  });
});

describe("computeBestEstimate", () => {
  it("computes amount * probability rounded to 2 decimals", () => {
    expect(computeBestEstimate(10000, 0.55)).toBe(5500);
  });

  it("rounds to 2 decimal places", () => {
    expect(computeBestEstimate(1234.56, 0.65)).toBe(802.46);
  });

  it("returns 0 when amount is null", () => {
    expect(computeBestEstimate(null, 0.55)).toBe(0);
  });

  it("returns 0 when amount is 0", () => {
    expect(computeBestEstimate(0, 0.55)).toBe(0);
  });

  it("returns 0 when amount is negative", () => {
    expect(computeBestEstimate(-500, 0.55)).toBe(0);
  });
});

describe("computeSCR", () => {
  it("computes 15% of best estimate", () => {
    expect(computeSCR(10000)).toBe(1500);
  });

  it("rounds to 2 decimal places", () => {
    expect(computeSCR(1234.56)).toBe(185.18);
  });

  it("returns 0 when best estimate is 0", () => {
    expect(computeSCR(0)).toBe(0);
  });

  it("returns 0 when best estimate is negative (max with 0)", () => {
    expect(computeSCR(-100)).toBe(0);
  });
});

describe("computeRiskMargin", () => {
  it("computes 6% * SCR / riskFreeRate", () => {
    // 0.06 * 1500 / 0.035 = 2571.428... => 2571.43
    expect(computeRiskMargin(1500, 0.035)).toBe(2571.43);
  });

  it("rounds to 2 decimal places", () => {
    expect(computeRiskMargin(185.18, 0.035)).toBe(317.45);
  });

  it("returns 0 when riskFreeRate is 0", () => {
    expect(computeRiskMargin(1500, 0)).toBe(0);
  });

  it("returns 0 when riskFreeRate is negative", () => {
    expect(computeRiskMargin(1500, -0.01)).toBe(0);
  });
});
