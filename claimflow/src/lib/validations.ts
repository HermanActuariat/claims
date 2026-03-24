import { z } from "zod";

// Claim schemas
export const CreateClaimSchema = z.object({
  type: z.enum([
    "COLLISION",
    "THEFT",
    "VANDALISM",
    "GLASS",
    "FIRE",
    "NATURAL_DISASTER",
    "BODILY_INJURY",
    "OTHER",
  ]),
  description: z.string().min(10, "Description trop courte (min 10 caractères)"),
  incidentDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  incidentLocation: z.string().min(5, "Lieu requis"),
  incidentCity: z.string().optional(),
  incidentZipCode: z.string().optional(),
  incidentCountry: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  thirdPartyInvolved: z.boolean().default(false),
  thirdPartyInfo: z
    .object({
      name: z.string().optional(),
      plate: z.string().optional(),
      insurance: z.string().optional(),
      contact: z.string().optional(),
    })
    .optional(),
  policyholderID: z.string().cuid("ID assuré invalide"),
});

export const UpdateClaimSchema = CreateClaimSchema.partial();

export const ClaimStatusSchema = z.object({
  status: z.enum([
    "SUBMITTED",
    "UNDER_REVIEW",
    "INFO_REQUESTED",
    "APPROVED",
    "REJECTED",
    "CLOSED",
  ]),
  reason: z.string().optional(),
  approvedAmount: z.number().positive().optional(),
});

export const AssignClaimSchema = z.object({
  userId: z.string().cuid("ID utilisateur invalide"),
});

// Policyholder schemas
export const CreatePolicyholderSchema = z.object({
  firstName: z.string().min(1, "Prénom requis"),
  lastName: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide"),
  phone: z.string().min(10, "Téléphone invalide"),
  address: z.string().min(10, "Adresse requise"),
  vehicleMake: z.string().min(1, "Marque du véhicule requise"),
  vehicleModel: z.string().min(1, "Modèle du véhicule requis"),
  vehicleYear: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  vehiclePlate: z.string().min(4, "Plaque d'immatriculation invalide"),
  vehicleVin: z.string().optional(),
  policyNumber: z.string().min(5, "Numéro de police requis"),
  contractStart: z.string(),
  contractEnd: z.string(),
  coverageType: z.enum(["THIRD_PARTY", "COMPREHENSIVE", "ALL_RISKS"]),
});

export const UpdatePolicyholderSchema = CreatePolicyholderSchema.partial();

// Comment schema
export const CreateCommentSchema = z.object({
  content: z.string().min(1, "Commentaire vide"),
  isInternal: z.boolean().default(true),
});

// AI schemas
export const AIExtractSchema = z.object({
  claimId: z.string().cuid(),
  description: z.string().min(1),
});

export const AIFraudSchema = z.object({
  claimId: z.string().cuid(),
});

export const AIEstimateSchema = z.object({
  claimId: z.string().cuid(),
});

export const AILetterSchema = z.object({
  claimId: z.string().cuid(),
  letterType: z.enum([
    "ACKNOWLEDGMENT",
    "DOCUMENT_REQUEST",
    "APPROVAL",
    "REJECTION",
    "INFO_REQUEST",
  ]),
});

// User schemas (admin)
export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, "Mot de passe trop court (min 8 caractères)"),
  role: z.enum(["HANDLER", "MANAGER", "ADMIN"]),
});

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["HANDLER", "MANAGER", "ADMIN"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

// Portail assuré — décision sur un sinistre approuvé
export const PortailDecisionSchema = z
  .object({
    decision: z.enum(["ACCEPT", "REJECT"]),
    reason: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "REJECT" && (!data.reason || data.reason.length < 20)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Le motif doit contenir au moins 20 caractères",
        path: ["reason"],
      });
    }
  });

// Query param schemas
export const ClaimQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  status: z
    .enum([
      "SUBMITTED",
      "UNDER_REVIEW",
      "INFO_REQUESTED",
      "APPROVED",
      "REJECTED",
      "CLOSED",
    ])
    .optional(),
  type: z
    .enum([
      "COLLISION",
      "THEFT",
      "VANDALISM",
      "GLASS",
      "FIRE",
      "NATURAL_DISASTER",
      "BODILY_INJURY",
      "OTHER",
    ])
    .optional(),
  search: z.string().optional(),
  assignedToId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const DashboardPeriodSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "custom"]).default("30d"),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: z
    .enum([
      "COLLISION",
      "THEFT",
      "VANDALISM",
      "GLASS",
      "FIRE",
      "NATURAL_DISASTER",
      "BODILY_INJURY",
      "OTHER",
    ])
    .optional(),
});

export const TeamDashboardQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

export const BulkAssignSchema = z.object({
  claimIds: z.array(z.string()).min(1, "Au moins un sinistre requis").max(50, "Maximum 50 sinistres"),
  assignToId: z.string().min(1, "ID utilisateur cible requis"),
});

// Fraud Network schemas
export const FraudNetworkQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["score_desc", "score_asc", "date_desc", "date_asc"]).default("score_desc"),
});

export const FraudNetworkActionSchema = z.object({
  action: z.enum(["DISMISS", "ESCALATE"]),
  reason: z.string().min(10).max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export const RecomputeSchema = z.object({
  scope: z.enum(["FULL", "INCREMENTAL"]).default("INCREMENTAL"),
});

// ─── OCR & Document Classification schemas ──────────────────────────────────

export const OcrRequestSchema = z.object({
  documentId: z.string().cuid("ID document invalide"),
  imageBase64: z.string().min(1, "Image requise").optional(),
});

export const ClassifyDocumentSchema = z.object({
  documentId: z.string().cuid("ID document invalide"),
  filename: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
});

export const ImportEconstatSchema = z.object({
  claimId: z.string().cuid("ID sinistre invalide"),
  data: z.string().min(1, "Données e-constat requises"),
  format: z.enum(["XML", "JSON"]).default("JSON"),
});

// ─── Explainability & Contestation schemas ──────────────────────────────────

export const CreateContestationSchema = z.object({
  reason: z.string().min(10, "Le motif doit contenir au moins 10 caractères").max(2000),
});

export const ResolveContestationSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED"]),
  resolution: z.string().min(10, "La résolution doit contenir au moins 10 caractères").max(2000),
});

// ─── Automation Rules schemas ───────────────────────────────────────────────

const RuleConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

export const CreateRuleSchema = z.object({
  name: z.string().min(3, "Nom trop court (min 3 caractères)").max(100),
  description: z.string().max(500).optional(),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
  conditions: z.array(RuleConditionSchema).min(1, "Au moins une condition requise"),
  action: z.enum(["AUTO_APPROVE", "ESCALATE_TO_MANAGER", "REQUEST_INFO", "FLAG_FRAUD"]),
  actionParams: z.record(z.unknown()).optional(),
});

export const UpdateRuleSchema = CreateRuleSchema.partial();

export const SimulateRuleSchema = z.object({
  claimId: z.string().cuid("ID sinistre invalide"),
});

export const RuleExecutionLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  ruleId: z.string().optional(),
  claimId: z.string().optional(),
});

// ─── AI Provider schemas ────────────────────────────────────────────────────

export const UpdateProviderConfigSchema = z.object({
  active: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  defaultModel: z.string().min(1).optional(),
  maxTokens: z.number().int().min(1).max(32768).optional(),
});

// ─── SRA Barème & Garage Quotes schemas ─────────────────────────────────────

export const CreateRepairReferenceSchema = z.object({
  category: z.enum(["BODY", "MECHANICS", "GLASS", "PAINT", "ELECTRICAL", "INTERIOR", "OTHER"]),
  subcategory: z.string().min(2, "Sous-catégorie requise").max(100),
  vehicleSegment: z.enum(["CITY", "SEDAN", "SUV", "PREMIUM", "UTILITY"]),
  avgPartCost: z.number().min(0, "Coût pièces >= 0"),
  avgLaborHours: z.number().min(0, "Heures MO >= 0"),
  avgLaborRate: z.number().min(0, "Taux horaire >= 0"),
  source: z.enum(["SRA_OBSERVATOIRE", "MANUAL", "SRA_API"]).default("MANUAL"),
  regionFactor: z.record(z.string(), z.number().min(0.5).max(2.0)).optional(),
  validFrom: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  validUntil: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
});

export const UpdateRepairReferenceSchema = CreateRepairReferenceSchema.partial();

export const RepairReferenceQuerySchema = z.object({
  category: z.enum(["BODY", "MECHANICS", "GLASS", "PAINT", "ELECTRICAL", "INTERIOR", "OTHER"]).optional(),
  vehicleSegment: z.enum(["CITY", "SEDAN", "SUV", "PREMIUM", "UTILITY"]).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
});

export const ValidateGarageQuoteSchema = z.object({
  validated: z.boolean(),
});

export const ComputeEstimationQuerySchema = z.object({
  claimId: z.string().min(1, "ID sinistre requis"),
  department: z.string().regex(/^\d{2,3}$/, "Département invalide (2-3 chiffres)").optional(),
});
