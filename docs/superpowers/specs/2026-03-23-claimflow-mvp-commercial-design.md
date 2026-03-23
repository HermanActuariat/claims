# ClaimFlow AI — MVP Commercial Design Spec

**Date :** 2026-03-23
**Objectif :** Transformer le POC en MVP commercialisable pour courtiers en assurance auto
**Horizon :** 12 semaines (3 phases de 4 semaines)
**Approche :** Métier d'abord — features IA différenciantes en P1, processus assurance en P2, infra & UX en P3

---

## Contexte

ClaimFlow AI est un POC fonctionnel avec 56 routes API, 20 pages, 4 workflows IA (extraction, fraude, estimation, courriers), compliance complète (ACPR, RGPD, Solvabilité II), portail assuré, réseaux de fraude, et risk scoring géographique.

L'étude de faisabilité (2026-03-23) identifie 6 écarts critiques entre le POC et le marché réel. L'audit codebase révèle 5 gaps techniques additionnels à combler.

**Cible MVP :** Courtiers en assurance auto gérant des flottes et sinistres (cycles de vente courts, décision rapide, besoin immédiat d'optimisation).

---

## Conventions transversales

### Permissions par feature
| Route / Page | Rôles autorisés |
|---|---|
| `/api/admin/rules`, `/admin/rules` | MANAGER, ADMIN |
| `/api/admin/ai-providers`, `/admin` (section IA) | ADMIN |
| `/api/admin/repair-references`, `/admin/repair-references` | MANAGER, ADMIN |
| `/api/admin/experts`, `/admin/experts` | MANAGER, ADMIN |
| `/analytics/ai-supervision` | MANAGER (stats équipe), ADMIN (stats globales). HANDLER voit uniquement ses propres contestations. |
| `/api/expert-portal/*` | Public avec token JWT signé (pas d'auth NextAuth) |
| `/api/claims/[id]/vei/*` | HANDLER (lecture), MANAGER+ (mutations) |
| Toutes les autres routes API | Selon RBAC existant (auth() en première instruction) |

### Dépendances inter-features (P1)
- Le **moteur de règles** (feature 3) ne doit PAS exécuter `AUTO_APPROVE` tant que l'**explicabilité IA** (feature 2) n'a pas produit un `explainabilityReport` sur l'analyse concernée.
- L'**OCR** (feature 1) est requis par l'import e-constat (canal 2 — scan papier) et par le barème SRA (feature 8 — extraction devis garage).

### Séquence de calcul (P2)
L'ordre de calcul pour un sinistre est : **estimation SRA** (barème interne ou devis garage) → **détection VEI** (si ratio coût/valeur > seuil) → **mandat expert** (si VEI ou montant > 1 000 € HT). La VEI ne peut être détectée qu'après qu'un coût de réparation existe.

### Consentement RGPD pour OCR/IA
Tout document uploadé pour analyse IA (OCR, classification, extraction) nécessite un consentement explicite de l'assuré. L'UI affiche : *"Ce document sera analysé par un service d'IA (Anthropic Claude). En continuant, vous consentez au traitement."* Le consentement est stocké dans `Document.metadata.gdprConsent: { accepted: true, at: ISO8601 }`.

---

## Roadmap

| Phase | Semaines | Features | Objectif |
|-------|----------|----------|----------|
| **P1 — Cœur IA & métier** | S1-S4 | E-constat + OCR, Explicabilité IA, Moteur de règles, Multi-provider IA | Démo courtier solide |
| **P2 — Processus assurance** | S5-S8 | Convention IRSA, Procédure VEI, Workflow Expert, Barème SRA | Crédibilité métier réelle |
| **P3 — Infra & UX** | S9-S12 | Temps réel SSE, Recherche full-text | Expérience produit fluide |

---

## Phase 1 — Cœur IA & métier (S1-S4)

### 1. Import e-constat + OCR documents

**Deux canaux d'entrée dans le wizard de création de sinistre :**

**Canal 1 — E-constat numérique (XML/JSON) :**
- Nouveau step 0 dans le wizard : "Importer un e-constat"
- Parsing déterministe : mapping champs XML → champs Prisma `Claim` (date, lieu, véhicules, circonstances, blessés, tiers)
- Pré-remplissage automatique du wizard, l'utilisateur valide/corrige
- Création automatique du `Policyholder` tiers si absent

**Canal 2 — Constat papier / document scanné (OCR IA) :**
- Upload d'un PDF ou image (photo smartphone du constat papier)
- Nouveau service `lib/ocr-service.ts` utilisant Claude Vision (`claude-sonnet-4-6` avec capacité image)
- Le modèle reçoit l'image + un prompt structuré → retourne les champs extraits en JSON
- Même pré-remplissage que le canal numérique
- Score de confiance par champ extrait : **vert ≥ 80%**, **orange 50-79%**, **rouge < 50%**
- Si OCR échoue complètement (erreur API ou confiance globale < 30%) : fallback vers le formulaire manuel avec le document original affiché à côté

**Validation e-constat XML :**
- Champs requis : `dateAccident`, `lieuAccident`, `vehiculeA`, `vehiculeB`, `circonstances`
- Champs optionnels : `blessures`, `temoins`, `observations`
- Si un champ requis est absent : erreur de validation avec message guidant l'utilisateur vers la saisie manuelle
- Versions supportées : format e-constat auto v2 (standard depuis 2019)

**Classification automatique de documents :**
- À l'upload de tout document sur un sinistre, classification IA automatique
- Types : `CONSTAT_AMIABLE`, `FACTURE_REPARATION`, `PHOTO_DOMMAGE`, `RAPPORT_EXPERT`, `CARTE_GRISE`, `PERMIS`, `DEVIS`, `AUTRE`
- Stockage du type dans le modèle `Document` (nouveau champ `documentType`)
- Le gestionnaire peut corriger la classification

**Modèle Prisma — ajouts :**

```prisma
// Ajouts sur Document existant
model Document {
  documentType    DocumentType?
  ocrData         Json?
  ocrConfidence   Float?
}

enum DocumentType {
  CONSTAT_AMIABLE
  FACTURE_REPARATION
  PHOTO_DOMMAGE
  RAPPORT_EXPERT
  CARTE_GRISE
  PERMIS
  DEVIS
  AUTRE
}
```

**Routes API :**
- `POST /api/claims/import-econstat` — Parse XML e-constat → données pré-remplies
- `POST /api/ai/ocr` — Upload image/PDF → extraction OCR via Claude Vision
- `POST /api/ai/classify-document` — Classification automatique du type de document

**Services :** `lib/ocr-service.ts`, `lib/econstat-parser.ts`

---

### 2. Explicabilité IA / Conformité AI Act

**Rapport d'explicabilité (sur chaque `AIAnalysis`) :**
- Nouveau champ `explainabilityReport` (JSON structuré) généré à chaque appel IA :
  - `factors[]` — Facteurs détectés avec poids, description en langage naturel, source de données
  - `reasoning` — Raisonnement étape par étape (chain-of-thought exposé)
  - `confidence` — Score de confiance global du modèle
  - `limitations` — Ce que le modèle n'a pas pu évaluer (données manquantes)
  - `humanActionRequired` — Booléen + description de l'action attendue
- Mention systématique : *"Cette analyse est une aide à la décision. La décision finale revient au gestionnaire."*

**Format JSON du rapport d'explicabilité :**
```json
{
  "factors": [{ "name": "string", "weight": 0.0, "description": "string", "source": "string" }],
  "reasoning": "string (chain-of-thought)",
  "confidence": 0.85,
  "limitations": ["string"],
  "humanActionRequired": true,
  "humanActionDescription": "string"
}
```

**Droit de contestation :**
- L'assuré ou le gestionnaire peut contester une analyse IA
- Workflow : `SUBMITTED` → `UNDER_REVIEW` → `UPHELD` / `OVERTURNED`
- Chaque contestation déclenche un re-calcul avec les éléments fournis
- Audit trail complet

**Supervision humaine formalisée :**
- Aucune décision automatique finale sans validation humaine
- Le moteur de règles peut proposer une décision, jamais l'exécuter seul sur les cas sensibles (score fraude > 50 ou montant > 5 000 €)
- Dashboard "Supervision IA" pour managers : taux de contestation, taux d'override, accuracy

**Modèle Prisma :**

```prisma
// Ajouts sur AIAnalysis existant
model AIAnalysis {
  explainabilityReport  Json?
  confidenceScore       Float?
  contestations         AIContestation[]
}

model AIContestation {
  id              String              @id @default(cuid())
  analysisId      String
  analysis        AIAnalysis          @relation(fields: [analysisId], references: [id])
  contestedById   String
  contestedBy     User                @relation(fields: [contestedById], references: [id])
  reason          String
  additionalData  Json?
  status          ContestationStatus
  resolution      String?
  resolvedById    String?
  resolvedBy      User?               @relation(fields: [resolvedById], references: [id])
  resolvedAt      DateTime?
  createdAt       DateTime            @default(now())
}

enum ContestationStatus {
  SUBMITTED
  UNDER_REVIEW
  UPHELD
  OVERTURNED
}
```

**Routes API :**
- `POST /api/claims/[id]/analyses/[analysisId]/contest` — Soumettre une contestation
- `PATCH /api/claims/[id]/analyses/[analysisId]/contest/[contestId]` — Résoudre (manager+)
- `GET /api/analytics/ai-supervision` — Stats supervision IA

**UI :**
- Refonte `FraudScoreCard` et `EstimationCard` : onglet "Explicabilité" + bouton "Contester"
- Nouvelle page `/analytics/ai-supervision` (managers)

---

### 3. Moteur de règles automatiques

**Architecture :**
- Règles configurables en base de données par les managers
- Évaluées à chaque changement de statut ou après une analyse IA
- Évaluation séquentielle par priorité, première règle qui matche s'applique

**Types de conditions :**
- `amount` < | > | == | between [valeur]
- `fraudScore` < | > | == | between [valeur]
- `claimType` in [COLLISION, THEFT, GLASS_BREAK, ...]
- `documentCount` >= [valeur]
- `policyholderRiskLevel` in [LOW, MODERATE, HIGH, CRITICAL]
- `daysSinceSubmission` > [valeur]

**Types d'actions :**
- `AUTO_APPROVE` — Passe en APPROVED (si supervision OK)
- `AUTO_REJECT` — Passe en REJECTED (si supervision OK)
- `ESCALATE_TO_MANAGER` — Assigne au manager
- `ESCALATE_TO_EXPERT` — Déclenche workflow expert
- `REQUEST_DOCUMENTS` — Génère courrier demande de pièces
- `FLAG_FRAUD` — Marque pour investigation
- `ASSIGN_TO_HANDLER` — Affecte au gestionnaire le moins chargé
- `NOTIFY` — Notification spécifique

**Garde-fous (appliqués au runtime dans `rules-engine.ts`) :**
- `AUTO_APPROVE` bloqué si `fraudScore > 50` OU `amount > 5000€` OU `explainabilityReport` absent → rétrogradé en `ESCALATE_TO_MANAGER`
- `AUTO_REJECT` **interdit en base** : le service refuse la création/modification d'une règle avec `action: AUTO_REJECT`. À runtime, toute tentative est rétrogradée en `ESCALATE_TO_MANAGER` avec recommandation rejet
- Chaque exécution logguée dans `RuleExecutionLog` avec : ruleId, claimId, action tentée, conditions évaluées, résultat, blockedReason si applicable
- Un manager peut désactiver une règle à tout moment

**Modèle Prisma :**

```prisma
model AutomationRule {
  id              String              @id @default(cuid())
  name            String
  description     String?
  conditions      Json
  action          RuleAction
  priority        Int                 @default(0)
  isActive        Boolean             @default(true)
  createdById     String
  createdBy       User                @relation(fields: [createdById], references: [id])
  executionCount  Int                 @default(0)
  lastExecutedAt  DateTime?
  executionLogs   RuleExecutionLog[]
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

model RuleExecutionLog {
  id            String     @id @default(cuid())
  ruleId        String
  rule          AutomationRule @relation(fields: [ruleId], references: [id])
  claimId       String
  claim         Claim      @relation(fields: [claimId], references: [id])
  action        RuleAction
  wasBlocked    Boolean    @default(false)
  blockedReason String?
  executedAt    DateTime   @default(now())
}

enum RuleAction {
  AUTO_APPROVE
  AUTO_REJECT
  ESCALATE_TO_MANAGER
  ESCALATE_TO_EXPERT
  REQUEST_DOCUMENTS
  FLAG_FRAUD
  ASSIGN_TO_HANDLER
  NOTIFY
}
```

**Routes API :**
- `GET/POST /api/admin/rules` — CRUD des règles (MANAGER+)
- `PATCH/DELETE /api/admin/rules/[id]` — Modifier/supprimer
- `POST /api/admin/rules/simulate` — Dry-run sur sinistres existants
- `GET /api/admin/rules/execution-logs` — Historique d'exécution

**Service :** `lib/rules-engine.ts`

**UI :**
- Page `/admin/rules` — Liste des règles, toggle actif/inactif, stats d'exécution
- Formulaire builder visuel de conditions (dropdowns chaînés)
- Mode simulation : "Cette règle s'appliquerait à X sinistres existants"

---

### 4. Multi-provider IA avec fallback

**Architecture :**

```
Code métier (ai-service.ts)
    ↓
lib/ai-provider.ts (abstraction)
    ↓
Provider primaire (Claude) → si erreur/timeout → Provider fallback (OpenAI/Mistral)
```

**Comportement :**
- Interface unifiée `AIProvider` avec les 5 méthodes : `extract`, `scoreFraud`, `estimate`, `generateLetter`, `classifyDocument`
- Configuration en base de données → un manager peut changer la priorité sans redéployer
- Circuit breaker : après 3 échecs consécutifs sur un provider, bascule immédiate sur le provider suivant par priorité pendant 5 minutes. Pas de file d'attente — le fallback est instantané. Si tous les providers sont en circuit ouvert, l'appel échoue avec HTTP 503 et est loggué
- Logging : provider utilisé, latence, tokens, succès/échec, raison du fallback
- Rétention des logs : 90 jours, puis purge automatique (via cron existant)

**Providers supportés (MVP) :**
- **Claude** (`claude-sonnet-4-6`) — Primaire
- **OpenAI** (`gpt-4o`) — Fallback
- **Mistral** (`mistral-large`) — Fallback secondaire (argument souveraineté)

**Adaptation des prompts :**
- Prompts systèmes dans `lib/prompts/` restent la source de vérité
- Chaque provider peut avoir un `promptAdapter` léger pour le format
- Format de sortie JSON identique quel que soit le provider

**Modèle Prisma :**

```prisma
model AIProviderConfig {
  id            String          @id @default(cuid())
  provider      AIProviderType
  model         String
  apiKeyEnvVar  String
  priority      Int             @default(0)
  isActive      Boolean         @default(true)
  maxRetries    Int             @default(2)
  timeoutMs     Int             @default(30000)
  updatedById   String
  updatedBy     User            @relation(fields: [updatedById], references: [id])
  updatedAt     DateTime        @updatedAt
}

model AIProviderLog {
  id            String          @id @default(cuid())
  provider      AIProviderType
  model         String
  operation     String
  claimId       String?
  claim         Claim?          @relation(fields: [claimId], references: [id])
  success       Boolean
  latencyMs     Int
  tokensUsed    Int?
  errorMessage  String?
  wasFallback   Boolean         @default(false)
  createdAt     DateTime        @default(now())
}

enum AIProviderType {
  ANTHROPIC
  OPENAI
  MISTRAL
}
```

**Routes API :**
- `GET/PATCH /api/admin/ai-providers` — Configurer les providers (ADMIN)
- `GET /api/admin/ai-providers/stats` — Santé des providers (uptime, latence, taux d'erreur)

**Impact sur le code existant :**
- `ai-service.ts` appelle `aiProvider.extract()` au lieu d'Anthropic directement
- Les 4 routes `/api/ai/*` restent identiques côté API
- `AIAnalysis` : ajout champ `provider` en plus du `model` existant

**UI :**
- Section "Configuration IA" dans `/admin` : liste providers, priorité drag-and-drop, toggle
- Widget santé IA dans le dashboard manager

---

## Phase 2 — Processus assurance (S5-S8)

### 5. Convention IRSA — Barèmes de responsabilité

**Contexte :** Convention IRSA = répartition de responsabilité entre assureurs pour sinistres matériels auto < 6 500 € de dommages.

**Données de référence 2026 :**
- Forfait recours IRSA : **2 030 €**
- Forfait partage 50/50 : **850 €**
- Plafond recours forfaitaire : **6 500 €**
- Seuil expertise obligatoire : **1 000 € HT**

**13 cas IDA codifiés :**

| Cas | Circonstance | X | Y |
|-----|-------------|---|---|
| 10 | Même file, X heurté à l'arrière | 0% | 100% |
| 13 | Deux files, aucun changement | 50% | 50% |
| 15 | Y change de file | 0% | 100% |
| 17 | Y vire à gauche, chaussée latérale | 50% | 50% |
| 20 | Sens inverse, Y empiète axe médian | 0% | 100% |
| 21 | Sens inverse, les deux empiètent | 50% | 50% |
| 30 | Chaussées différentes, X prioritaire | 0% | 100% |
| 31 | X prioritaire mais empiète axe médian | 50% | 50% |
| 40 | Stationnement régulier | 0% | 100% |
| 43 | Stationnement irrégulier | 50% | 50% |
| 50 A-D | Infractions absolues | 0% | 100% |
| 51 A-E | Infractions relatives | 0% | 100% |
| 56 | Exception (indéterminé) | 50% | 50% |

**IA-assisted :** Claude analyse les circonstances (texte libre + cases cochées du constat) et propose le cas IDA le plus probable avec score de confiance. Le service `irsa-service.ts` valide que la suggestion IA correspond à un cas IDA existant (10, 13, 15, 17, 20, 21, 30, 31, 40, 43, 50, 51, 56). Si la suggestion est invalide ou ambiguë, le gestionnaire sélectionne manuellement depuis un dropdown des 13 cas.

**Modèle Prisma :**

```prisma
model ClaimLiability {
  id                  String    @id @default(cuid())
  claimId             String    @unique
  claim               Claim     @relation(fields: [claimId], references: [id])
  irsaCaseNumber      Int?
  irsaCaseDescription String?
  liabilityRate       Int                   // 0, 50, ou 100
  aiSuggestedCase     Int?
  aiConfidence        Float?
  isValidated         Boolean   @default(false)
  validatedById       String?
  validatedBy         User?     @relation(fields: [validatedById], references: [id])
  validatedAt         DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}

model SubrogationClaim {
  id                String             @id @default(cuid())
  claimId           String
  claim             Claim              @relation(fields: [claimId], references: [id])
  thirdPartyInsurer String
  thirdPartyRef     String?
  amountClaimed     Float
  amountRecovered   Float?
  status            SubrogationStatus
  sentAt            DateTime?
  resolvedAt        DateTime?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
}

enum SubrogationStatus {
  DRAFT
  SENT
  ACKNOWLEDGED
  NEGOTIATION
  ACCEPTED
  PARTIALLY_ACCEPTED
  REJECTED
  RECOVERED
  CLOSED
}
```

**Routes API :**
- `GET/POST /api/claims/[id]/liability` — Déterminer/modifier la responsabilité IRSA
- `POST /api/ai/irsa-analysis` — IA analyse circonstances → propose cas IDA
- `GET/POST /api/claims/[id]/subrogation` — Créer/suivre un recours
- `PATCH /api/claims/[id]/subrogation/[subId]` — Mettre à jour le statut

**Services :** `lib/irsa-service.ts` (barèmes codifiés, montants configurables), `lib/prompts/irsa.ts`

**UI :**
- Onglet "Responsabilité" dans la fiche sinistre : cas IDA proposé par l'IA, taux, validation
- Section "Recours" : tableau des subrogations avec statut, montants, timeline

---

### 6. Procédure VEI — Véhicule Économiquement Irréparable

**Déclenchement :**
- Automatique : si `coûtRéparation > valeurVénale × seuil` (configurable, défaut 100%)
- Manuel : le gestionnaire peut forcer le passage en VEI
- Via moteur de règles : `ESCALATE_TO_EXPERT` quand le ratio approche le seuil

**Workflow :**
```
DETECTED → EXPERT_MANDATED → EXPERT_REPORT_RECEIVED → OFFER_CALCULATED →
OFFER_SENT → OFFER_ACCEPTED → SALVAGE_TRANSFER → CLOSED
           → OFFER_CONTESTED → COUNTER_EXPERTISE → OFFER_REVISED → ...
```

**Calcul indemnisation VEI :**
```
indemnité = VRADE - franchise - (valeurÉpave si rachat par assuré)
```

**Modèle Prisma :**

```prisma
model VeiProcedure {
  id                    String       @id @default(cuid())
  claimId               String       @unique
  claim                 Claim        @relation(fields: [claimId], references: [id])
  status                VeiStatus
  repairCost            Float
  vehicleValue          Float
  costToValueRatio      Float
  detectedAt            DateTime
  detectedBy            String                // "AI_ESTIMATION" | "EXPERT_REPORT" | "MANUAL"
  expertMissionId       String?
  expertMission         ExpertMission? @relation(fields: [expertMissionId], references: [id])
  vradeAmount           Float?
  salvageValue          Float?
  offerAmount           Float?
  offerSentAt           DateTime?
  offerDeadline         DateTime?
  policyholderDecision  VeiDecision?
  decisionAt            DateTime?
  contestReason         String?
  salvageBuyback        Boolean      @default(false)
  buybackAmount         Float?
  salvageTransferRef    String?
  closedAt              DateTime?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
}

enum VeiStatus {
  DETECTED
  EXPERT_MANDATED
  EXPERT_REPORT_RECEIVED
  OFFER_CALCULATED
  OFFER_SENT
  OFFER_ACCEPTED
  OFFER_CONTESTED
  COUNTER_EXPERTISE
  OFFER_REVISED
  SALVAGE_TRANSFER
  CLOSED
}

enum VeiDecision {
  ACCEPTED
  ACCEPTED_WITH_BUYBACK
  CONTESTED
}
```

**Routes API :**
- `GET /api/claims/[id]/vei` — État de la procédure VEI
- `POST /api/claims/[id]/vei/detect` — Déclencher/forcer la détection
- `POST /api/claims/[id]/vei/offer` — Calculer et envoyer l'offre
- `PATCH /api/claims/[id]/vei/decision` — Enregistrer la décision assuré
- `PATCH /api/claims/[id]/vei/status` — Transitions de statut

**Service :** `lib/vei-service.ts`

**Relation VEI ↔ Expert :** Les missions d'expertise peuvent exister indépendamment d'une procédure VEI (expertise classique > 1 000 € HT). La VEI est un déclencheur parmi d'autres. `ExpertMission` porte un `veiProcedureId` optionnel pour lier les deux quand applicable. Sur contestation VEI (`OFFER_CONTESTED`), le manager crée une nouvelle `ExpertMission` avec `missionType: COUNTER` et la lie à la `VeiProcedure` existante.

**UI :**
- Bandeau alerte rouge dans la fiche sinistre quand VEI détecté
- Onglet "Procédure VEI" : timeline workflow, offre, réponse assuré
- Portail assuré : notification + formulaire acceptation/contestation/rachat

---

### 7. Workflow Expert Automobile

**Périmètre :** Gestion du mandat, suivi, réception du rapport. Pas d'intégration API Darva/Sinapps au MVP — email + upload.

**Workflow :**
```
DRAFT → SENT → ACCEPTED → INSPECTION_SCHEDULED → INSPECTION_DONE →
REPORT_SUBMITTED → REPORT_VALIDATED → CLOSED
                 → REPORT_CONTESTED → COUNTER_EXPERTISE
```

**Mini-portail expert (pages publiques avec token JWT 7j) :**
- `/expert/[token]` — Vue de la mission
- `/expert/[token]/schedule` — Planifier l'inspection
- `/expert/[token]/report` — Upload rapport + champs structurés

**Modèle Prisma :**

```prisma
model Expert {
  id            String          @id @default(cuid())
  name          String
  company       String?
  email         String          @unique
  phone         String?
  speciality    String?
  region        String?
  isActive      Boolean         @default(true)
  missions      ExpertMission[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

model ExpertMission {
  id                  String        @id @default(cuid())
  claimId             String
  claim               Claim         @relation(fields: [claimId], references: [id])
  expertId            String
  expert              Expert        @relation(fields: [expertId], references: [id])
  assignedById        String
  assignedBy          User          @relation(fields: [assignedById], references: [id])
  status              MissionStatus
  missionType         MissionType
  missionNotes        String?
  accessToken         String        @unique
  tokenExpiresAt      DateTime
  inspectionDate      DateTime?
  inspectionLocation  String?
  reportDocumentId    String?
  reportDocument      Document?     @relation(fields: [reportDocumentId], references: [id])
  reportData          Json?
  vradeAmount         Float?
  repairCost          Float?
  vehicleCondition    String?
  expertNotes         String?
  validatedById       String?
  validatedBy         User?         @relation(fields: [validatedById], references: [id])
  validatedAt         DateTime?
  contestReason       String?
  sentAt              DateTime?
  acceptedAt          DateTime?
  reportSubmittedAt   DateTime?
  closedAt            DateTime?
  veiProcedure        VeiProcedure?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
}

enum MissionStatus {
  DRAFT
  SENT
  ACCEPTED
  INSPECTION_SCHEDULED
  INSPECTION_DONE
  REPORT_SUBMITTED
  REPORT_VALIDATED
  REPORT_CONTESTED
  COUNTER_EXPERTISE
  CLOSED
}

enum MissionType {
  STANDARD
  VEI
  COUNTER
  COMPLEMENTARY
}
```

**Routes API :**

Côté gestionnaire :
- `GET/POST /api/experts` — CRUD annuaire experts
- `GET/PATCH /api/experts/[id]` — Détail/modifier
- `POST /api/claims/[id]/expert-missions` — Créer une mission
- `GET /api/claims/[id]/expert-missions` — Lister les missions
- `PATCH /api/claims/[id]/expert-missions/[missionId]` — Valider/contester rapport

Côté expert (portail public) :
- `GET /api/expert-portal/[token]` — Infos de la mission
- `PATCH /api/expert-portal/[token]/accept` — Accepter
- `PATCH /api/expert-portal/[token]/schedule` — Planifier inspection
- `POST /api/expert-portal/[token]/report` — Upload rapport
- `POST /api/claims/[id]/expert-missions/[missionId]/refresh-token` — Régénérer le token expert (MANAGER+, prolonge de +7 jours)

**Service :** `lib/expert-service.ts`

**UI :**
- Page `/admin/experts` — Annuaire des experts
- Onglet "Expertise" dans la fiche sinistre
- Pages `/expert/[token]/*` — Mini-portail expert (mobile-first)

---

### 8. Barème SRA — Référentiel pièces et main-d'œuvre

**Stratégie en 3 niveaux :**

| Niveau | Source | Précision | MVP |
|--------|--------|-----------|-----|
| N1 — Barème interne | Fourchettes par type, données publiques SRA | ±30% | Oui |
| N2 — Connecteur SRA | API/fichier SRA officiel | ±5% | Non (négociation) |
| N3 — Devis garage réel | Upload devis, extraction IA des lignes | Exact | Oui |

**On implémente N1 + N3, architecture prête pour N2.**

**Modèle Prisma :**

```prisma
model RepairReference {
  id              String          @id @default(cuid())
  category        RepairCategory
  subcategory     String
  vehicleSegment  VehicleSegment
  avgPartCost     Float
  avgLaborHours   Float
  avgLaborRate    Float
  source          String                // "SRA_OBSERVATOIRE" | "MANUAL" | "SRA_API"
  regionFactor    Json?                 // Map département → coefficient : { "75": 1.15, "69": 1.05, "default": 1.0 }
  validFrom       DateTime
  validUntil      DateTime?
  updatedById     String
  updatedBy       User            @relation(fields: [updatedById], references: [id])
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

enum RepairCategory {
  BODY
  MECHANICS
  GLASS
  PAINT
  ELECTRICAL
  INTERIOR
  OTHER
}

enum VehicleSegment {
  CITY
  SEDAN
  SUV
  PREMIUM
  UTILITY
}

model GarageQuote {
  id              String            @id @default(cuid())
  claimId         String
  claim           Claim             @relation(fields: [claimId], references: [id])
  documentId      String
  document        Document          @relation(fields: [documentId], references: [id])
  garageName      String?
  garageCity      String?
  totalAmount     Float?
  lines           GarageQuoteLine[]
  extractedByAI   Boolean           @default(false)
  validatedById   String?
  validatedBy     User?             @relation(fields: [validatedById], references: [id])
  validatedAt     DateTime?
  createdAt       DateTime          @default(now())
}

model GarageQuoteLine {
  id              String        @id @default(cuid())
  quoteId         String
  quote           GarageQuote   @relation(fields: [quoteId], references: [id])
  lineType        QuoteLineType
  description     String
  partReference   String?
  quantity        Int           @default(1)
  unitPriceHT     Float
  laborHours      Float?
  laborRateHT     Float?
  totalHT         Float
  confidence      Float?
}

enum QuoteLineType {
  PART
  LABOR
  PAINT
  CONSUMABLE
  OTHER
}
```

**Routes API :**
- `GET /api/admin/repair-references` — Liste barèmes
- `POST/PATCH /api/admin/repair-references` — Créer/modifier (MANAGER+)
- `POST /api/claims/[id]/garage-quotes` — Upload devis → extraction IA
- `GET /api/claims/[id]/garage-quotes` — Liste devis
- `PATCH /api/claims/[id]/garage-quotes/[quoteId]/validate` — Valider lignes
- `GET /api/estimation/compute` — Calcul estimation basé barème + zone géo

**Service :** `lib/sra-service.ts`

**Impact estimation existante :**
- Claude reçoit le barème interne + devis garage dans son prompt → estimation ancrée sur données réelles
- `EstimationCard` affiche la source : "Basé sur barème SRA interne" ou "Basé sur devis garage [Nom]"

**UI :**
- Page `/admin/repair-references` — Table éditable des barèmes
- Onglet "Devis" dans la fiche sinistre
- Refonte `EstimationCard` : breakdown avec source, comparaison barème vs devis

---

## Phase 3 — Infra & UX (S9-S12)

### 9. Temps réel SSE

**Choix technique : SSE (Server-Sent Events) plutôt que WebSocket.**
- Unidirectionnel serveur → client (couvre 95% du besoin)
- Natif Next.js App Router (Route Handlers avec `ReadableStream`)
- Compatible Vercel, pas de serveur WS à maintenir
- Reconnexion automatique native (`EventSource`)

**Événements :**

| Événement | Déclencheur | Consommateurs |
|-----------|-------------|---------------|
| `claim:created` | Nouveau sinistre | Dashboard, liste sinistres |
| `claim:statusChanged` | Transition de statut | Fiche sinistre, dashboard, portail assuré |
| `claim:assigned` | Affectation gestionnaire | Dashboard équipe |
| `claim:analyzed` | Analyse IA terminée | Fiche sinistre (panels IA) |
| `notification:new` | Toute notification | Badge navbar |
| `rule:executed` | Moteur de règles déclenché | Dashboard manager |
| `expert:reportSubmitted` | Expert upload rapport | Fiche sinistre |
| `vei:statusChanged` | Transition VEI | Fiche sinistre, portail assuré |
| `stats:updated` | Recalcul KPIs (debounced 30s) | Dashboard stats |

**Architecture :**

```
Mutation (API route / service)
    ↓
lib/realtime-service.ts (EventEmitter singleton)
    ↓
/api/sse/[channel] (SSE stream vers client)
    ↓
Hook React useRealtimeEvent(channel, eventType, callback)
```

**Channels :** `dashboard`, `claim:{id}`, `user:{id}`, `portal:{policyholderId}`

**Intégration progressive :** Les composants gardent leur fetch initial. Le SSE met à jour le state local en complément. Si SSE indisponible, tout fonctionne comme avant.

**Reconnexion :** Côté client, backoff exponentiel (1s, 2s, 4s, 8s max). Après 10 tentatives échouées, fallback vers polling toutes les 30s. L'indicateur de connexion passe à gris pendant les tentatives.

**Routes API :**
- `GET /api/sse/dashboard` — Stream dashboard
- `GET /api/sse/claim/[id]` — Stream sinistre
- `GET /api/sse/notifications` — Stream notifications utilisateur

**Service :** `lib/realtime-service.ts`

**UI :**
- `NotificationBadge` : pulse animation + compteur live
- Dashboard : KPIs et charts rafraîchis sans reload
- Fiche sinistre : panels IA, timeline, statut en live
- Indicateur de connexion discret (point vert/gris)

---

### 10. Recherche full-text PostgreSQL

**Choix technique : PostgreSQL FTS plutôt qu'Elasticsearch.**
- Déjà en place (Supabase = PostgreSQL)
- Suffisant pour le volume MVP (< 100K sinistres)
- Configuration française native (`french` text search config)

**Périmètre de recherche :**

| Source | Champs indexés |
|--------|---------------|
| Claim | claimNumber, description, location, vehicleMake, vehicleModel, vehiclePlate |
| Comment | content |
| AIAnalysis | outputData |
| Policyholder | firstName, lastName, email, phone, address |
| ExpertMission | expertNotes, reportData |
| GarageQuote | garageName, lignes description |

**Implémentation :**
1. Colonne `searchVector` (type `tsvector`) sur les tables principales
2. Index GIN sur chaque `searchVector`
3. Dictionnaire français (`to_tsvector('french', ...)`)
4. Migration SQL brute (Prisma ne supporte pas tsvector nativement)
5. Service avec `$queryRaw` pour les requêtes full-text

**Routes API :**
- `GET /api/search?q=dupont+pare-brise&types=claims,policyholders&limit=20`
- Retourne : `{ results: [{ type, id, title, excerpt, score, url }] }`

**Service :** `lib/search-service.ts`

**UI :**
- Barre de recherche globale dans la navbar (`Ctrl+K` / `Cmd+K`)
- Dropdown résultats groupés par type avec highlight
- Filtres : type de résultat, période, statut

---

## Résumé des impacts

### Nouveaux modèles Prisma (10)
1. `AIContestation` — Contestation d'analyse IA
2. `AutomationRule` — Règle d'automatisation
3. `RuleExecutionLog` — Log d'exécution des règles
4. `AIProviderConfig` — Configuration providers IA
5. `AIProviderLog` — Log des appels IA par provider
6. `ClaimLiability` — Responsabilité IRSA
7. `SubrogationClaim` — Recours inter-assureurs
8. `VeiProcedure` — Procédure véhicule irréparable
9. `Expert` — Annuaire experts automobiles
10. `ExpertMission` — Mission d'expertise

### Modèles Prisma modifiés (3)
- `RepairReference` — Barème pièces/MO (nouveau)
- `GarageQuote` + `GarageQuoteLine` — Devis garage (nouveaux)
- `Document` — Ajout `documentType`, `ocrData`, `ocrConfidence`
- `AIAnalysis` — Ajout `explainabilityReport`, `confidenceScore`, `provider`

### Nouveaux enums (13)
`DocumentType`, `ContestationStatus`, `RuleAction`, `AIProviderType`, `SubrogationStatus`, `VeiStatus`, `VeiDecision`, `MissionStatus`, `MissionType`, `RepairCategory`, `VehicleSegment`, `QuoteLineType`

### Nouvelles routes API (~30)
- P1 : 12 routes (OCR, explicabilité, règles, providers)
- P2 : 14 routes (IRSA, VEI, expert, SRA)
- P3 : 4 routes (SSE, recherche)

### Nouveaux services (8)
`ocr-service.ts`, `econstat-parser.ts`, `rules-engine.ts`, `ai-provider.ts`, `irsa-service.ts`, `vei-service.ts`, `expert-service.ts`, `sra-service.ts`, `realtime-service.ts`, `search-service.ts`

### Nouvelles pages UI (7)
- `/admin/rules` — Gestion des règles
- `/admin/experts` — Annuaire experts
- `/admin/repair-references` — Barèmes SRA
- `/analytics/ai-supervision` — Supervision IA
- `/expert/[token]` — Mini-portail expert (3 sous-pages)

### Pages UI modifiées (5)
- `/claims/new` — Ajout import e-constat (step 0)
- `/claims/[id]` — Onglets responsabilité, VEI, expertise, devis, explicabilité
- `/dashboard` — KPIs live, widget santé IA
- `/admin` — Section configuration IA
- Navbar — Barre de recherche globale `Ctrl+K`
