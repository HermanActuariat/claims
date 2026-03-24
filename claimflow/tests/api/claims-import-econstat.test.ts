/**
 * Tests — POST /api/claims/import-econstat
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: {
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

// Mock the econstat parser to control output deterministically
vi.mock("@/lib/econstat-parser", () => ({
  parseEconstat: vi.fn(),
  validateEconstatData: vi.fn(),
}));

import { POST } from "@/app/api/claims/import-econstat/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parseEconstat, validateEconstatData } from "@/lib/econstat-parser";

type AuthReturn = ReturnType<typeof auth> extends Promise<infer T> ? T : never;
type ClaimReturn = ReturnType<typeof prisma.claim.findUnique> extends Promise<infer T>
  ? T
  : never;
type ClaimUpdateReturn = ReturnType<typeof prisma.claim.update> extends Promise<infer T>
  ? T
  : never;

const mockSession = {
  user: { id: "user-1", email: "handler@test.com", name: "Handler", role: "HANDLER" as const },
};

// A valid CUID-shaped ID
const VALID_CLAIM_ID = "clxabcd1234567890abcdef01";

const mockClaim = {
  id: VALID_CLAIM_ID,
  claimNumber: "CLM-2026-00001",
  status: "UNDER_REVIEW",
  type: "COLLISION",
  description: "Collision entre deux véhicules au carrefour.",
  incidentDate: new Date("2026-01-15"),
  incidentLocation: "Paris",
  thirdPartyInvolved: false,
  thirdPartyInfo: null,
  estimatedAmount: null,
  approvedAmount: null,
  fraudScore: null,
  policyholderID: "ph-1",
  assignedToID: "user-1",
  createdByID: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockEconstatData = {
  dateAccident: "2026-01-15",
  heureAccident: "14:30",
  lieuAccident: "Paris 15ème, rue de la Convention",
  vehiculeA: {
    marque: "Peugeot",
    modele: "308",
    immatriculation: "AB-123-CD",
    assureur: "AXA",
    numContrat: "AXA-001",
    conducteur: "Jean Dupont",
    permisNum: "123456",
  },
  vehiculeB: {
    marque: "Renault",
    modele: "Clio",
    immatriculation: "EF-456-GH",
    assureur: "MAIF",
    numContrat: "MAIF-001",
    conducteur: "Marie Martin",
    permisNum: "987654",
  },
  circonstances: ["Changement de file"],
  degats: ["Pare-chocs avant"],
  temoins: [],
  observations: null,
  croquis: false,
};

const validJSONData = JSON.stringify({
  dateAccident: "2026-01-15",
  lieuAccident: "Paris 15ème",
});

describe("POST /api/claims/import-econstat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as unknown as AuthReturn);
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(
      mockClaim as unknown as ClaimReturn
    );
    vi.mocked(prisma.claim.update).mockResolvedValue(
      mockClaim as unknown as ClaimUpdateReturn
    );
    vi.mocked(parseEconstat).mockReturnValue(mockEconstatData);
    vi.mocked(validateEconstatData).mockReturnValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as AuthReturn);

    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid body (missing claimId)", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when claimId is not a valid CUID", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: "not-a-cuid", data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 when data field is missing", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 when format is not XML or JSON", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "CSV" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 404 when claim is not found", async () => {
    vi.mocked(prisma.claim.findUnique).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/introuvable/i);
  });

  it("returns 201 with econstatData and warnings on success", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.econstatData).toBeDefined();
    expect(body.data.warnings).toEqual([]);
    expect(body.data.claimId).toBe(VALID_CLAIM_ID);
    expect(body.data.fieldsUpdated).toBeDefined();
  });

  it("calls parseEconstat with correct data and format", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "JSON" }),
    });
    await POST(req);

    expect(parseEconstat).toHaveBeenCalledWith(validJSONData, "JSON");
  });

  it("accepts XML format", async () => {
    const xmlData = "<econstat><dateAccident>2026-01-15</dateAccident></econstat>";
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: xmlData, format: "XML" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(parseEconstat).toHaveBeenCalledWith(xmlData, "XML");
  });

  it("includes validation warnings in response", async () => {
    vi.mocked(validateEconstatData).mockReturnValue([
      "Date de l'accident manquante",
      "Aucune circonstance renseignée",
    ]);

    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData, format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.warnings).toHaveLength(2);
    expect(body.data.warnings).toContain("Date de l'accident manquante");
  });

  it("returns 500 when parseEconstat throws", async () => {
    vi.mocked(parseEconstat).mockImplementation(() => {
      throw new Error("Format JSON invalide pour l'e-constat");
    });

    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: "INVALID{{", format: "JSON" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("defaults format to JSON when not specified", async () => {
    const req = new NextRequest("http://localhost/api/claims/import-econstat", {
      method: "POST",
      body: JSON.stringify({ claimId: VALID_CLAIM_ID, data: validJSONData }),
    });
    const res = await POST(req);

    // format defaults to JSON per schema, so it should succeed
    expect(res.status).toBe(201);
    expect(parseEconstat).toHaveBeenCalledWith(validJSONData, "JSON");
  });
});
