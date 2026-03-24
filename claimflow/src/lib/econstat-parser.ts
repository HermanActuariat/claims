/**
 * Parseur déterministe pour e-constat (XML/JSON)
 * N'utilise PAS d'IA — parsing pur basé sur les formats e-constat français
 */

import { EconstatData, EconstatVehicle, EconstatTemoin } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nullIfEmpty(val: string | null | undefined): string | null {
  if (!val || val.trim() === "") return null;
  return val.trim();
}

function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(re);
  return match ? nullIfEmpty(match[1]) : null;
}

function extractXmlTagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const val = nullIfEmpty(match[1]);
    if (val) results.push(val);
  }
  return results;
}

function extractXmlBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "i");
  const match = xml.match(re);
  return match ? match[0] : null;
}

function parseVehicleFromXml(block: string): EconstatVehicle {
  return {
    marque: extractXmlTag(block, "marque") ?? extractXmlTag(block, "brand"),
    modele: extractXmlTag(block, "modele") ?? extractXmlTag(block, "model"),
    immatriculation:
      extractXmlTag(block, "immatriculation") ??
      extractXmlTag(block, "registration") ??
      extractXmlTag(block, "plaque"),
    assureur:
      extractXmlTag(block, "assureur") ??
      extractXmlTag(block, "assurance") ??
      extractXmlTag(block, "insurer"),
    numContrat:
      extractXmlTag(block, "numContrat") ??
      extractXmlTag(block, "numeroContrat") ??
      extractXmlTag(block, "policyNumber"),
    conducteur:
      extractXmlTag(block, "conducteur") ??
      extractXmlTag(block, "driver") ??
      extractXmlTag(block, "nomConducteur"),
    permisNum:
      extractXmlTag(block, "permisNum") ??
      extractXmlTag(block, "numeroPerm") ??
      extractXmlTag(block, "licenseNumber"),
  };
}

function parseVehicleFromObject(obj: Record<string, unknown>): EconstatVehicle {
  const str = (key: string): string | null => {
    const v = obj[key];
    return typeof v === "string" ? nullIfEmpty(v) : null;
  };
  return {
    marque: str("marque") ?? str("brand"),
    modele: str("modele") ?? str("model"),
    immatriculation: str("immatriculation") ?? str("registration") ?? str("plaque"),
    assureur: str("assureur") ?? str("assurance") ?? str("insurer"),
    numContrat: str("numContrat") ?? str("numeroContrat") ?? str("policyNumber"),
    conducteur: str("conducteur") ?? str("driver") ?? str("nomConducteur"),
    permisNum: str("permisNum") ?? str("numeroPerm") ?? str("licenseNumber"),
  };
}

function parseTemoinFromObject(obj: Record<string, unknown>): EconstatTemoin {
  const str = (key: string): string | null => {
    const v = obj[key];
    return typeof v === "string" ? nullIfEmpty(v) : null;
  };
  return {
    nom: str("nom") ?? str("name"),
    adresse: str("adresse") ?? str("address"),
    telephone: str("telephone") ?? str("phone") ?? str("tel"),
  };
}

// ─── JSON Parser ─────────────────────────────────────────────────────────────

export function parseEconstatJSON(data: string): EconstatData {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error("Format JSON invalide pour l'e-constat");
  }

  const str = (key: string): string | null => {
    const v = obj[key];
    return typeof v === "string" ? nullIfEmpty(v) : null;
  };

  // Circonstances : peut être tableau ou string
  let circonstances: string[] = [];
  const circ = obj["circonstances"] ?? obj["circumstances"];
  if (Array.isArray(circ)) {
    circonstances = circ.filter((c): c is string => typeof c === "string" && c.trim() !== "");
  } else if (typeof circ === "string" && circ.trim() !== "") {
    circonstances = circ.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // Dégâts
  let degats: string[] = [];
  const dmg = obj["degats"] ?? obj["damages"] ?? obj["dommages"];
  if (Array.isArray(dmg)) {
    degats = dmg.filter((d): d is string => typeof d === "string" && d.trim() !== "");
  } else if (typeof dmg === "string" && dmg.trim() !== "") {
    degats = dmg.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // Témoins
  let temoins: EconstatTemoin[] = [];
  const temArray = obj["temoins"] ?? obj["witnesses"];
  if (Array.isArray(temArray)) {
    temoins = temArray
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .map(parseTemoinFromObject);
  }

  // Véhicules
  const vehA = obj["vehiculeA"] ?? obj["vehicleA"] ?? obj["vehicule_a"];
  const vehB = obj["vehiculeB"] ?? obj["vehicleB"] ?? obj["vehicule_b"];

  const vehiculeA =
    typeof vehA === "object" && vehA !== null
      ? parseVehicleFromObject(vehA as Record<string, unknown>)
      : null;

  const vehiculeB =
    typeof vehB === "object" && vehB !== null
      ? parseVehicleFromObject(vehB as Record<string, unknown>)
      : null;

  const croquis = obj["croquis"];

  return {
    dateAccident:
      str("dateAccident") ?? str("dateAccident") ?? str("date") ?? str("accidentDate"),
    heureAccident: str("heureAccident") ?? str("heure") ?? str("time") ?? str("accidentTime"),
    lieuAccident:
      str("lieuAccident") ?? str("lieu") ?? str("location") ?? str("accidentLocation"),
    vehiculeA,
    vehiculeB,
    circonstances,
    degats,
    temoins,
    observations: str("observations") ?? str("notes") ?? str("comments"),
    croquis: typeof croquis === "boolean" ? croquis : croquis === "true" || croquis === "1",
  };
}

// ─── XML Parser ──────────────────────────────────────────────────────────────

export function parseEconstatXML(data: string): EconstatData {
  // Extract accident info
  const dateAccident =
    extractXmlTag(data, "dateAccident") ??
    extractXmlTag(data, "date") ??
    extractXmlTag(data, "accidentDate");

  const heureAccident =
    extractXmlTag(data, "heureAccident") ??
    extractXmlTag(data, "heure") ??
    extractXmlTag(data, "time");

  const lieuAccident =
    extractXmlTag(data, "lieuAccident") ??
    extractXmlTag(data, "lieu") ??
    extractXmlTag(data, "location");

  // Circonstances
  const circTags = extractXmlTagAll(data, "circonstance");
  const circBlock = extractXmlTag(data, "circonstances") ?? extractXmlTag(data, "circumstances");
  const circonstances =
    circTags.length > 0
      ? circTags
      : circBlock
      ? circBlock.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  // Dégâts
  const degatTags = extractXmlTagAll(data, "degat");
  const degatBlock =
    extractXmlTag(data, "degats") ??
    extractXmlTag(data, "damages") ??
    extractXmlTag(data, "dommages");
  const degats =
    degatTags.length > 0
      ? degatTags
      : degatBlock
      ? degatBlock.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  // Témoins
  const temoinBlocks: EconstatTemoin[] = [];
  const temoinXmlBlocks = extractXmlTagAll(data, "temoin");
  for (const block of temoinXmlBlocks) {
    temoinBlocks.push({
      nom: extractXmlTag(block, "nom") ?? extractXmlTag(block, "name"),
      adresse: extractXmlTag(block, "adresse") ?? extractXmlTag(block, "address"),
      telephone:
        extractXmlTag(block, "telephone") ??
        extractXmlTag(block, "phone") ??
        extractXmlTag(block, "tel"),
    });
  }

  // Véhicules
  const vehABlock = extractXmlBlock(data, "vehiculeA") ?? extractXmlBlock(data, "vehicleA");
  const vehBBlock = extractXmlBlock(data, "vehiculeB") ?? extractXmlBlock(data, "vehicleB");

  const vehiculeA = vehABlock ? parseVehicleFromXml(vehABlock) : null;
  const vehiculeB = vehBBlock ? parseVehicleFromXml(vehBBlock) : null;

  const croquis =
    extractXmlTag(data, "croquis") === "true" || extractXmlTag(data, "croquis") === "1";

  const observations =
    extractXmlTag(data, "observations") ??
    extractXmlTag(data, "notes") ??
    extractXmlTag(data, "comments");

  return {
    dateAccident,
    heureAccident,
    lieuAccident,
    vehiculeA,
    vehiculeB,
    circonstances,
    degats,
    temoins: temoinBlocks,
    observations,
    croquis,
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function parseEconstat(data: string, format: "XML" | "JSON"): EconstatData {
  if (format === "JSON") return parseEconstatJSON(data);
  return parseEconstatXML(data);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateEconstatData(data: EconstatData): string[] {
  const warnings: string[] = [];

  if (!data.dateAccident) {
    warnings.push("Date de l'accident manquante");
  }
  if (!data.heureAccident) {
    warnings.push("Heure de l'accident manquante");
  }
  if (!data.lieuAccident) {
    warnings.push("Lieu de l'accident manquant");
  }
  if (!data.vehiculeA) {
    warnings.push("Informations du véhicule A manquantes");
  } else {
    if (!data.vehiculeA.immatriculation) {
      warnings.push("Immatriculation du véhicule A manquante");
    }
    if (!data.vehiculeA.assureur) {
      warnings.push("Assureur du véhicule A manquant");
    }
    if (!data.vehiculeA.conducteur) {
      warnings.push("Conducteur du véhicule A manquant");
    }
  }
  if (!data.vehiculeB) {
    warnings.push("Informations du véhicule B manquantes");
  } else {
    if (!data.vehiculeB.immatriculation) {
      warnings.push("Immatriculation du véhicule B manquante");
    }
    if (!data.vehiculeB.assureur) {
      warnings.push("Assureur du véhicule B manquant");
    }
  }
  if (data.circonstances.length === 0) {
    warnings.push("Aucune circonstance renseignée");
  }
  if (data.degats.length === 0) {
    warnings.push("Aucun dégât renseigné");
  }

  return warnings;
}
