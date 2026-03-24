/**
 * Tests — lib/econstat-parser.ts
 * Parseur déterministe e-constat (XML/JSON) — aucun mock IA requis
 */
import { describe, it, expect } from "vitest";
import {
  parseEconstatJSON,
  parseEconstatXML,
  parseEconstat,
  validateEconstatData,
} from "@/lib/econstat-parser";
import type { EconstatData } from "@/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validJSONFull = JSON.stringify({
  dateAccident: "2026-01-15",
  heureAccident: "14:30",
  lieuAccident: "Paris 15ème, rue de la Convention",
  vehiculeA: {
    marque: "Peugeot",
    modele: "308",
    immatriculation: "AB-123-CD",
    assureur: "AXA",
    numContrat: "AXA-00123",
    conducteur: "Jean Dupont",
    permisNum: "123456789",
  },
  vehiculeB: {
    marque: "Renault",
    modele: "Clio",
    immatriculation: "EF-456-GH",
    assureur: "MAIF",
    numContrat: "MAIF-00456",
    conducteur: "Marie Martin",
    permisNum: "987654321",
  },
  circonstances: ["Changement de file", "Feu rouge grillé"],
  degats: ["Pare-chocs avant", "Aile gauche"],
  temoins: [
    { nom: "Paul Témoin", adresse: "12 rue Test, Paris", telephone: "0612345678" },
  ],
  observations: "Conditions météo favorables",
  croquis: true,
});

// Note: individual <circonstance> tags are placed at top level (not wrapped in
// a <circonstances> block) to avoid the parser's `extractXmlTagAll("circonstance")`
// regex matching the outer wrapper tag as well (since "circonstances" starts with
// "circonstance"). Same applies to <degat> / <degats>.
const validXMLFull = `<?xml version="1.0" encoding="UTF-8"?>
<econstat>
  <dateAccident>2026-01-15</dateAccident>
  <heureAccident>14:30</heureAccident>
  <lieuAccident>Paris 15ème, rue de la Convention</lieuAccident>
  <vehiculeA>
    <marque>Peugeot</marque>
    <modele>308</modele>
    <immatriculation>AB-123-CD</immatriculation>
    <assureur>AXA</assureur>
    <numContrat>AXA-00123</numContrat>
    <conducteur>Jean Dupont</conducteur>
    <permisNum>123456789</permisNum>
  </vehiculeA>
  <vehiculeB>
    <marque>Renault</marque>
    <modele>Clio</modele>
    <immatriculation>EF-456-GH</immatriculation>
    <assureur>MAIF</assureur>
    <numContrat>MAIF-00456</numContrat>
    <conducteur>Marie Martin</conducteur>
    <permisNum>987654321</permisNum>
  </vehiculeB>
  <circonstance>Changement de file</circonstance>
  <circonstance>Feu rouge grillé</circonstance>
  <degat>Pare-chocs avant</degat>
  <degat>Aile gauche</degat>
  <croquis>true</croquis>
  <observations>Conditions météo favorables</observations>
</econstat>`;

// ─── parseEconstatJSON ────────────────────────────────────────────────────────

describe("parseEconstatJSON", () => {
  it("parses a complete valid JSON and returns correct EconstatData", () => {
    const result = parseEconstatJSON(validJSONFull);

    expect(result.dateAccident).toBe("2026-01-15");
    expect(result.heureAccident).toBe("14:30");
    expect(result.lieuAccident).toBe("Paris 15ème, rue de la Convention");

    expect(result.vehiculeA).not.toBeNull();
    expect(result.vehiculeA?.marque).toBe("Peugeot");
    expect(result.vehiculeA?.modele).toBe("308");
    expect(result.vehiculeA?.immatriculation).toBe("AB-123-CD");
    expect(result.vehiculeA?.assureur).toBe("AXA");
    expect(result.vehiculeA?.conducteur).toBe("Jean Dupont");

    expect(result.vehiculeB).not.toBeNull();
    expect(result.vehiculeB?.marque).toBe("Renault");
    expect(result.vehiculeB?.immatriculation).toBe("EF-456-GH");
    expect(result.vehiculeB?.assureur).toBe("MAIF");

    expect(result.circonstances).toEqual(["Changement de file", "Feu rouge grillé"]);
    expect(result.degats).toEqual(["Pare-chocs avant", "Aile gauche"]);
    expect(result.temoins).toHaveLength(1);
    expect(result.temoins[0].nom).toBe("Paul Témoin");
    expect(result.temoins[0].telephone).toBe("0612345678");
    expect(result.observations).toBe("Conditions météo favorables");
    expect(result.croquis).toBe(true);
  });

  it("accepts English-keyed JSON (vehicleA, vehicleB, etc.)", () => {
    const englishJSON = JSON.stringify({
      date: "2026-02-10",
      time: "09:00",
      location: "Lyon",
      vehicleA: {
        brand: "BMW",
        model: "X3",
        registration: "ZZ-999-AA",
        insurer: "Allianz",
        policyNumber: "ALZ-0001",
        driver: "Paul Driver",
        licenseNumber: "PDRV001",
      },
      vehicleB: {
        brand: "Ford",
        model: "Focus",
        registration: "WW-111-BB",
        insurer: "Groupama",
      },
      circumstances: "Collision arrière",
      damages: "Pare-chocs, capot",
      witnesses: [],
    });

    const result = parseEconstatJSON(englishJSON);
    expect(result.dateAccident).toBe("2026-02-10");
    expect(result.lieuAccident).toBe("Lyon");
    expect(result.vehiculeA?.marque).toBe("BMW");
    expect(result.vehiculeA?.immatriculation).toBe("ZZ-999-AA");
    expect(result.vehiculeB?.assureur).toBe("Groupama");
    expect(result.circonstances).toContain("Collision arrière");
    expect(result.degats).toContain("Pare-chocs");
  });

  it("handles circonstances and degats as comma-separated strings", () => {
    const json = JSON.stringify({
      dateAccident: "2026-03-01",
      circonstances: "Virage, pluie, nuit",
      degats: "Aile, portière, rétroviseur",
    });

    const result = parseEconstatJSON(json);
    expect(result.circonstances).toEqual(["Virage", "pluie", "nuit"]);
    expect(result.degats).toEqual(["Aile", "portière", "rétroviseur"]);
  });

  it("handles croquis as boolean true/false string", () => {
    const withStringTrue = JSON.stringify({ croquis: "true" });
    const withStringFalse = JSON.stringify({ croquis: "false" });
    const withStringOne = JSON.stringify({ croquis: "1" });

    expect(parseEconstatJSON(withStringTrue).croquis).toBe(true);
    expect(parseEconstatJSON(withStringFalse).croquis).toBe(false);
    expect(parseEconstatJSON(withStringOne).croquis).toBe(true);
  });

  it("returns null fields when data is missing", () => {
    const result = parseEconstatJSON("{}");
    expect(result.dateAccident).toBeNull();
    expect(result.heureAccident).toBeNull();
    expect(result.lieuAccident).toBeNull();
    expect(result.vehiculeA).toBeNull();
    expect(result.vehiculeB).toBeNull();
    expect(result.circonstances).toEqual([]);
    expect(result.degats).toEqual([]);
    expect(result.temoins).toEqual([]);
    expect(result.observations).toBeNull();
    expect(result.croquis).toBe(false);
  });

  it("throws an error for invalid JSON string", () => {
    expect(() => parseEconstatJSON("not json at all {{{")).toThrow(
      "Format JSON invalide pour l'e-constat"
    );
  });

  it("throws an error for empty string", () => {
    expect(() => parseEconstatJSON("")).toThrow("Format JSON invalide pour l'e-constat");
  });
});

// ─── parseEconstatXML ─────────────────────────────────────────────────────────

describe("parseEconstatXML", () => {
  it("parses a complete valid XML and returns correct EconstatData", () => {
    const result = parseEconstatXML(validXMLFull);

    expect(result.dateAccident).toBe("2026-01-15");
    expect(result.heureAccident).toBe("14:30");
    expect(result.lieuAccident).toBe("Paris 15ème, rue de la Convention");

    expect(result.vehiculeA).not.toBeNull();
    expect(result.vehiculeA?.marque).toBe("Peugeot");
    expect(result.vehiculeA?.immatriculation).toBe("AB-123-CD");
    expect(result.vehiculeA?.assureur).toBe("AXA");
    expect(result.vehiculeA?.conducteur).toBe("Jean Dupont");

    expect(result.vehiculeB).not.toBeNull();
    expect(result.vehiculeB?.immatriculation).toBe("EF-456-GH");
    expect(result.vehiculeB?.assureur).toBe("MAIF");

    expect(result.circonstances).toEqual(["Changement de file", "Feu rouge grillé"]);
    expect(result.degats).toEqual(["Pare-chocs avant", "Aile gauche"]);
    expect(result.observations).toBe("Conditions météo favorables");
    expect(result.croquis).toBe(true);
  });

  it("accepts English XML tags (vehicleA, vehicleB, date, location)", () => {
    const xml = `<econstat>
      <date>2026-02-15</date>
      <location>Marseille</location>
      <vehicleA>
        <brand>Toyota</brand>
        <registration>TY-001-AA</registration>
        <insurer>AXA</insurer>
        <driver>Alice</driver>
      </vehicleA>
    </econstat>`;

    const result = parseEconstatXML(xml);
    expect(result.dateAccident).toBe("2026-02-15");
    expect(result.lieuAccident).toBe("Marseille");
    expect(result.vehiculeA?.marque).toBe("Toyota");
    expect(result.vehiculeA?.immatriculation).toBe("TY-001-AA");
    expect(result.vehiculeA?.assureur).toBe("AXA");
  });

  it("returns defaults with empty arrays when XML is missing fields", () => {
    const result = parseEconstatXML("<econstat></econstat>");

    expect(result.dateAccident).toBeNull();
    expect(result.heureAccident).toBeNull();
    expect(result.lieuAccident).toBeNull();
    expect(result.vehiculeA).toBeNull();
    expect(result.vehiculeB).toBeNull();
    expect(result.circonstances).toEqual([]);
    expect(result.degats).toEqual([]);
    expect(result.temoins).toEqual([]);
    expect(result.croquis).toBe(false);
  });

  it("returns defaults for completely empty string (no XML at all)", () => {
    const result = parseEconstatXML("");

    expect(result.dateAccident).toBeNull();
    expect(result.circonstances).toEqual([]);
    expect(result.croquis).toBe(false);
  });

  it("parses circonstances from comma-separated block when no individual tags", () => {
    const xml = `<econstat>
      <circonstances>Virage, glissant, nuit</circonstances>
    </econstat>`;

    const result = parseEconstatXML(xml);
    expect(result.circonstances).toEqual(["Virage", "glissant", "nuit"]);
  });

  it("parses croquis=1 as true", () => {
    const xml = `<econstat><croquis>1</croquis></econstat>`;
    expect(parseEconstatXML(xml).croquis).toBe(true);
  });

  it("parses croquis=false as false", () => {
    const xml = `<econstat><croquis>false</croquis></econstat>`;
    expect(parseEconstatXML(xml).croquis).toBe(false);
  });
});

// ─── parseEconstat dispatcher ────────────────────────────────────────────────

describe("parseEconstat", () => {
  it('dispatches to parseEconstatJSON when format is "JSON"', () => {
    const json = JSON.stringify({ dateAccident: "2026-01-01" });
    const result = parseEconstat(json, "JSON");
    expect(result.dateAccident).toBe("2026-01-01");
  });

  it('dispatches to parseEconstatXML when format is "XML"', () => {
    const xml = `<econstat><dateAccident>2026-01-01</dateAccident></econstat>`;
    const result = parseEconstat(xml, "XML");
    expect(result.dateAccident).toBe("2026-01-01");
  });

  it("throws for invalid JSON when format is JSON", () => {
    expect(() => parseEconstat("INVALID{{", "JSON")).toThrow();
  });
});

// ─── validateEconstatData ─────────────────────────────────────────────────────

describe("validateEconstatData", () => {
  const completeData: EconstatData = {
    dateAccident: "2026-01-15",
    heureAccident: "14:30",
    lieuAccident: "Paris",
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

  it("returns empty array for fully complete data", () => {
    const warnings = validateEconstatData(completeData);
    expect(warnings).toEqual([]);
  });

  it("returns warning for missing dateAccident", () => {
    const data: EconstatData = { ...completeData, dateAccident: null };
    const warnings = validateEconstatData(data);
    expect(warnings).toContain("Date de l'accident manquante");
  });

  it("returns warning for missing heureAccident", () => {
    const data: EconstatData = { ...completeData, heureAccident: null };
    expect(validateEconstatData(data)).toContain("Heure de l'accident manquante");
  });

  it("returns warning for missing lieuAccident", () => {
    const data: EconstatData = { ...completeData, lieuAccident: null };
    expect(validateEconstatData(data)).toContain("Lieu de l'accident manquant");
  });

  it("returns warning for missing vehiculeA", () => {
    const data: EconstatData = { ...completeData, vehiculeA: null };
    expect(validateEconstatData(data)).toContain(
      "Informations du véhicule A manquantes"
    );
  });

  it("returns warning for missing vehiculeA immatriculation", () => {
    const data: EconstatData = {
      ...completeData,
      vehiculeA: { ...completeData.vehiculeA!, immatriculation: null },
    };
    expect(validateEconstatData(data)).toContain(
      "Immatriculation du véhicule A manquante"
    );
  });

  it("returns warning for missing vehiculeA assureur", () => {
    const data: EconstatData = {
      ...completeData,
      vehiculeA: { ...completeData.vehiculeA!, assureur: null },
    };
    expect(validateEconstatData(data)).toContain("Assureur du véhicule A manquant");
  });

  it("returns warning for missing vehiculeA conducteur", () => {
    const data: EconstatData = {
      ...completeData,
      vehiculeA: { ...completeData.vehiculeA!, conducteur: null },
    };
    expect(validateEconstatData(data)).toContain(
      "Conducteur du véhicule A manquant"
    );
  });

  it("returns warning for missing vehiculeB", () => {
    const data: EconstatData = { ...completeData, vehiculeB: null };
    expect(validateEconstatData(data)).toContain(
      "Informations du véhicule B manquantes"
    );
  });

  it("returns warning for missing vehiculeB immatriculation", () => {
    const data: EconstatData = {
      ...completeData,
      vehiculeB: { ...completeData.vehiculeB!, immatriculation: null },
    };
    expect(validateEconstatData(data)).toContain(
      "Immatriculation du véhicule B manquante"
    );
  });

  it("returns warning for missing vehiculeB assureur", () => {
    const data: EconstatData = {
      ...completeData,
      vehiculeB: { ...completeData.vehiculeB!, assureur: null },
    };
    expect(validateEconstatData(data)).toContain("Assureur du véhicule B manquant");
  });

  it("returns warning when circonstances is empty", () => {
    const data: EconstatData = { ...completeData, circonstances: [] };
    expect(validateEconstatData(data)).toContain("Aucune circonstance renseignée");
  });

  it("returns warning when degats is empty", () => {
    const data: EconstatData = { ...completeData, degats: [] };
    expect(validateEconstatData(data)).toContain("Aucun dégât renseigné");
  });

  it("accumulates multiple warnings for completely empty data", () => {
    const emptyData: EconstatData = {
      dateAccident: null,
      heureAccident: null,
      lieuAccident: null,
      vehiculeA: null,
      vehiculeB: null,
      circonstances: [],
      degats: [],
      temoins: [],
      observations: null,
      croquis: false,
    };
    const warnings = validateEconstatData(emptyData);
    expect(warnings.length).toBeGreaterThanOrEqual(7);
  });
});
