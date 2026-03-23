import { prisma } from "@/lib/prisma";
import {
  ExplainabilityReport,
  ExplainabilityFactor,
  ContestationItem,
  FraudAnalysisResult,
  EstimationResult,
} from "@/types";

// ─── Internal helpers ────────────────────────────────────────────────────────

function mapContestationRecord(record: {
  id: string;
  analysisId: string;
  reason: string;
  status: string;
  resolution: string | null;
  contestedBy: string;
  resolvedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): ContestationItem {
  return {
    id: record.id,
    analysisId: record.analysisId,
    reason: record.reason,
    status: record.status as ContestationItem["status"],
    resolution: record.resolution,
    contestedBy: record.contestedBy,
    resolvedBy: record.resolvedBy,
    createdAt: record.createdAt.toISOString(),
    resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
  };
}

// ─── Fraud explainability ────────────────────────────────────────────────────

function buildFraudExplainability(
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>
): ExplainabilityReport {
  const fraud = outputData as unknown as FraudAnalysisResult;
  const score = typeof fraud.score === "number" ? fraud.score : 0;
  const fraudFactors = Array.isArray(fraud.factors) ? fraud.factors : [];

  const factors: ExplainabilityFactor[] = fraudFactors.map((f) => {
    const detected = Boolean(f.detected);
    const weight = typeof f.weight === "number" ? f.weight : 0;
    return {
      name: String(f.name ?? "Facteur inconnu"),
      description: String(f.description ?? ""),
      impact: detected ? (weight > 0.5 ? "negative" : "neutral") : "positive",
      weight,
      evidence: detected
        ? `Facteur détecté avec un poids de ${(weight * 100).toFixed(0)}%`
        : "Facteur non détecté — indicateur favorable",
    };
  });

  // Add contextual input factors
  if (inputData.thirdPartyInvolved === true) {
    factors.push({
      name: "Tiers impliqué",
      description: "Un tiers est impliqué dans le sinistre.",
      impact: "neutral",
      weight: 0.15,
      evidence: "Déclaration de tiers impliqué présente dans les données.",
    });
  }

  const documentCount = typeof inputData.documentCount === "number" ? inputData.documentCount : 0;
  if (documentCount === 0) {
    factors.push({
      name: "Absence de documents",
      description: "Aucun document justificatif n'a été fourni.",
      impact: "negative",
      weight: 0.2,
      evidence: "Nombre de documents fournis : 0.",
    });
  }

  const confidenceScore = Math.max(0, Math.min(1, 1 - score / 100));

  return {
    factors,
    methodology:
      "Le score de fraude est calculé par un modèle d'analyse multi-facteurs basé sur les caractéristiques du sinistre " +
      "(type, historique, délai de déclaration, cohérence des données, présence de documents, implication de tiers). " +
      "Chaque facteur contribue au score final pondéré de 0 à 100.",
    limitations: [
      "Le modèle peut produire des faux positifs sur certains types de sinistres rares.",
      "Les résultats sont indicatifs et doivent être confirmés par un gestionnaire.",
      "Les données météorologiques et contextuelles ne sont pas toujours disponibles.",
      "Le modèle n'a pas accès aux historiques assureurs tiers.",
    ],
    confidenceScore,
    dataSourcesUsed: [
      "Données sinistre (type, date, lieu, description)",
      "Profil assuré (ancienneté contrat, type de véhicule)",
      "Historique de déclarations",
      "Documents soumis (nombre et type)",
      "Score réseau de fraude (si disponible)",
    ],
  };
}

// ─── Estimation explainability ────────────────────────────────────────────────

function buildEstimationExplainability(
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>
): ExplainabilityReport {
  const estimation = outputData as unknown as EstimationResult;
  const total = typeof estimation.estimatedTotal === "number" ? estimation.estimatedTotal : 0;
  const breakdown = estimation.breakdown ?? { parts: 0, labor: 0, other: 0 };
  const confidence = estimation.confidence ?? "medium";
  const franchise = typeof estimation.franchise === "number" ? estimation.franchise : 0;

  const factors: ExplainabilityFactor[] = [];

  if (breakdown.parts > 0) {
    factors.push({
      name: "Coût des pièces",
      description: "Estimation du coût des pièces de rechange nécessaires.",
      impact: "neutral",
      weight: total > 0 ? breakdown.parts / total : 0,
      evidence: `Coût estimé des pièces : ${breakdown.parts.toFixed(2)} €`,
    });
  }

  if (breakdown.labor > 0) {
    factors.push({
      name: "Main d'oeuvre",
      description: "Coût de la main d'oeuvre pour la réparation.",
      impact: "neutral",
      weight: total > 0 ? breakdown.labor / total : 0,
      evidence: `Coût estimé de la main d'oeuvre : ${breakdown.labor.toFixed(2)} €`,
    });
  }

  if (breakdown.other > 0) {
    factors.push({
      name: "Frais annexes",
      description: "Autres frais associés (expertise, remorquage, véhicule de remplacement, etc.).",
      impact: "neutral",
      weight: total > 0 ? breakdown.other / total : 0,
      evidence: `Autres frais estimés : ${breakdown.other.toFixed(2)} €`,
    });
  }

  if (franchise > 0) {
    factors.push({
      name: "Franchise contractuelle",
      description: "Montant de la franchise déduit selon les termes du contrat.",
      impact: "negative",
      weight: total > 0 ? franchise / (total + franchise) : 0,
      evidence: `Franchise appliquée : ${franchise.toFixed(2)} €`,
    });
  }

  const claimType = typeof inputData.type === "string" ? inputData.type : "inconnu";
  factors.push({
    name: "Type de sinistre",
    description: `Le type de sinistre (${claimType}) influence le barème d'indemnisation.`,
    impact: "neutral",
    weight: 0.1,
    evidence: `Type de sinistre déclaré : ${claimType}`,
  });

  const confidenceMap: Record<string, number> = { low: 0.4, medium: 0.65, high: 0.85 };
  const confidenceScore = confidenceMap[confidence] ?? 0.65;

  return {
    factors,
    methodology:
      "L'estimation d'indemnisation est calculée à partir du type de sinistre, des dommages décrits, " +
      "du barème de réparation automobile (MCP), de l'ancienneté et du modèle du véhicule, " +
      "et des conditions contractuelles (franchise, couverture). " +
      "Le résultat est une fourchette [min, max] avec une estimation centrale.",
    limitations: [
      "L'estimation est indicative et peut différer du montant final après expertise.",
      "Les prix des pièces peuvent varier selon la disponibilité et le fournisseur.",
      "La dépréciation du véhicule n'est pas toujours intégrée dans l'estimation automatique.",
      "Les sinistres avec dommages corporels nécessitent une évaluation médicale séparée.",
    ],
    confidenceScore,
    dataSourcesUsed: [
      "Barème d'indemnisation MCP (serveur local)",
      "Description du sinistre",
      "Données véhicule (marque, modèle, année)",
      "Type de couverture contractuelle",
      "Montant estimé déclaré par l'assuré",
    ],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateExplainabilityReport(
  analysisType: string,
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown>
): Promise<ExplainabilityReport> {
  switch (analysisType) {
    case "FRAUD_SCORING":
      return buildFraudExplainability(inputData, outputData);
    case "ESTIMATION":
      return buildEstimationExplainability(inputData, outputData);
    default: {
      // Generic fallback for EXTRACTION and LETTER_GENERATION
      return {
        factors: [
          {
            name: "Analyse automatique",
            description: `Analyse de type ${analysisType} effectuée par le modèle IA.`,
            impact: "neutral",
            weight: 1.0,
            evidence: "Résultat produit par traitement automatique du texte.",
          },
        ],
        methodology: `Analyse de type ${analysisType} réalisée via un modèle de langage (LLM). Le modèle traite les données d'entrée et produit un résultat structuré.`,
        limitations: [
          "Les résultats sont générés par un modèle IA et peuvent contenir des erreurs.",
          "La vérification humaine est recommandée pour toute décision finale.",
        ],
        confidenceScore: 0.7,
        dataSourcesUsed: ["Description du sinistre", "Données contextuelles du dossier"],
      };
    }
  }
}

export async function submitContestation(
  analysisId: string,
  userId: string,
  reason: string
): Promise<ContestationItem> {
  const record = await prisma.aIContestation.create({
    data: {
      analysisId,
      reason,
      status: "PENDING",
      contestedBy: userId,
    },
  });

  return mapContestationRecord(record);
}

export async function resolveContestation(
  contestationId: string,
  userId: string,
  status: "ACCEPTED" | "REJECTED",
  resolution: string
): Promise<ContestationItem> {
  const record = await prisma.aIContestation.update({
    where: { id: contestationId },
    data: {
      status,
      resolution,
      resolvedBy: userId,
      resolvedAt: new Date(),
    },
  });

  // If accepted, mark the analysis for review by setting a flag in the explainabilityReport (non-blocking)
  if (status === "ACCEPTED") {
    void (async () => {
      try {
        const existing = await prisma.aIAnalysis.findUnique({
          where: { id: record.analysisId },
          select: { explainabilityReport: true },
        });
        const existingData: Record<string, unknown> = existing?.explainabilityReport
          ? (JSON.parse(existing.explainabilityReport) as Record<string, unknown>)
          : {};
        await prisma.aIAnalysis.update({
          where: { id: record.analysisId },
          data: {
            explainabilityReport: JSON.stringify({
              ...existingData,
              contestationAccepted: true,
              reviewRequired: true,
            }),
          },
        });
      } catch (err) {
        console.error("[explainability-service] Failed to flag analysis for review after accepted contestation:", err);
      }
    })();
  }

  return mapContestationRecord(record);
}

export async function getContestationsForAnalysis(analysisId: string): Promise<ContestationItem[]> {
  const records = await prisma.aIContestation.findMany({
    where: { analysisId },
    orderBy: { createdAt: "desc" },
  });

  return records.map(mapContestationRecord);
}

export async function getAISupervisionStats(): Promise<{
  totalAnalyses: number;
  contestationRate: number;
  overrideRate: number;
  avgConfidence: number;
  byType: Record<string, { count: number; avgConfidence: number }>;
}> {
  const [totalAnalyses, contestations, analysesWithConfidence, analysesByType] = await Promise.all([
    prisma.aIAnalysis.count(),
    prisma.aIContestation.findMany({ select: { status: true } }),
    prisma.aIAnalysis.findMany({
      where: { confidenceScore: { not: null } },
      select: { confidenceScore: true },
    }),
    prisma.aIAnalysis.groupBy({
      by: ["type"],
      _count: { id: true },
      _avg: { confidenceScore: true },
    }),
  ]);

  const totalContestations = contestations.length;
  const acceptedContestations = contestations.filter((c) => c.status === "ACCEPTED").length;

  const contestationRate =
    totalAnalyses > 0 ? Math.round((totalContestations / totalAnalyses) * 10000) / 100 : 0;

  const overrideRate =
    totalContestations > 0
      ? Math.round((acceptedContestations / totalContestations) * 10000) / 100
      : 0;

  const avgConfidence =
    analysesWithConfidence.length > 0
      ? Math.round(
          (analysesWithConfidence.reduce((sum, a) => sum + (a.confidenceScore ?? 0), 0) /
            analysesWithConfidence.length) *
            100
        ) / 100
      : 0;

  const byType: Record<string, { count: number; avgConfidence: number }> = {};
  for (const group of analysesByType) {
    byType[group.type] = {
      count: group._count.id,
      avgConfidence:
        Math.round((group._avg.confidenceScore ?? 0) * 100) / 100,
    };
  }

  return { totalAnalyses, contestationRate, overrideRate, avgConfidence, byType };
}
