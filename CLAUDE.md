# Claims Project — ClaimFlow AI

## Project Overview
Plateforme de gestion des sinistres automobiles augmentée par IA (Claude API).
Extraction automatique, scoring de fraude, estimation d'indemnisation, génération de courriers.

## Stack technique
- **Framework** : Next.js 15 (App Router, TypeScript strict)
- **UI** : Tailwind CSS + composants custom (shadcn-style)
- **ORM** : Prisma 6 (SQLite dev / PostgreSQL prod)
- **Auth** : NextAuth v5 (Credentials + JWT 8h)
- **IA** : Anthropic Claude API (claude-sonnet-4-6)
- **Tests** : Vitest + Testing Library + Playwright E2E
- **MCP** : serveur local barèmes d'indemnisation + Stitch MCP (design)
- **Design** : Stitch MCP — maquettes UI générées avant tout développement frontend

## Stitch Design System
Projet Stitch : `projects/4597385239557674039` — **ClaimFlow AI — Gestion des Sinistres**

### Écrans disponibles (thème clair, futuriste, insurtech)
| Écran | Screen ID | Description |
|-------|-----------|-------------|
| Login | *(voir Stitch)* | Split layout gradient indigo→teal + formulaire blanc |
| Dashboard | `be58ab6622fb4a0db5e4368e9ea63dfb` | KPIs + charts + alertes SLA |
| Liste sinistres | `dcbedb0409f04347b7f2de226f472836` | Table filtrable + score fraude |
| Détail sinistre | `a1d8d336a61c4e0eb1f6f73ac42e7246` | Fiche + IA + timeline statut |
| Nouveau sinistre | `8b8a5d16813941d086c9c4b16a14c976` | Wizard 4 étapes + upload |

### Design tokens imposés
- **Fond** : `#f8fafc` (slate-50)
- **Primaire** : `#4f46e5` (indigo-600)
- **Accent** : `#06b6d4` (cyan-500)
- **Typo** : Inter / Space Grotesk
- **Style** : Glassmorphism, soft shadows, badges colorés, moderne insurtech

### Règle absolue
> **Toute page frontend DOIT avoir un écran Stitch validé avant d'être développée.**
> Le `/frontend` et le `/run-pipeline` récupèrent le HTML Stitch comme référence de design.

## Structure
```
claims/
├── docs/               ← Specs BA + Architecture
├── claimflow/          ← Application Next.js 15
│   ├── prisma/         ← Schema + seed
│   ├── src/
│   │   ├── app/        ← Pages + API routes
│   │   ├── components/ ← UI components
│   │   ├── lib/        ← Services métier + IA
│   │   └── types/      ← Types partagés
│   ├── tests/          ← Vitest unit/integration
│   ├── e2e/            ← Playwright E2E
│   └── mcp/            ← Serveur MCP barèmes
```

## Conventions
- TypeScript strict : zéro `any`
- Zod sur 100% des entrées API
- Audit trail sur toutes les mutations
- Numérotation sinistres : `CLM-YYYY-NNNNN`
- Modèle IA : multi-provider via `callWithFallback()` (Groq `llama-3.3-70b-versatile` par défaut, Anthropic `claude-sonnet-4-6` en fallback)

## Commandes utiles (dans claimflow/)

```bash
# Installation
npm install

# Base de données
npx prisma migrate dev --name init
npx prisma db seed
npx prisma studio    # Interface web Prisma

# Développement
npm run dev          # → http://localhost:3000

# Tests
npm run test         # Vitest + coverage
npm run test:watch   # Mode watch
npm run test:e2e     # Playwright E2E

# Build production
npm run build
npm start

# MCP barèmes (dans mcp/)
npx ts-node mcp/baremes-server.ts
```

## Pipeline agents (agentpack.md)

### Commandes du workflow principal
| Commande | Agent | Mission |
|----------|-------|---------|
| `/ba` | Business Analyst | User Story → specs Gherkin + règles métier + JSON |
| `/architect` | Architecte | Specs → contrats API + Prisma + plan par équipe + DoD |
| `/design` | UX/Design (Stitch) | **ÉTAPE OBLIGATOIRE avant /frontend** — Génère/met à jour les écrans Stitch, récupère le HTML, définit les tokens design |
| `/backend` | Dev Backend | Plan → routes API + Prisma + Zod + audit trail + tests |
| `/frontend` | Dev Frontend | **Utilise les écrans Stitch comme référence** → pages + composants fidèles au design Stitch |
| `/ia` | IA Engineer | Prompts + fonctions Claude + endpoints IA + orchestration /analyze |
| `/qa` | QA | TDD Vitest + tests composants + E2E Playwright + coverage ≥ 60% |
| `/mcp` | MCP | Barèmes d'indemnisation via serveur MCP local + Stitch MCP design |
| `/review` | Release/Review | Audit sécurité + perf + lisibilité + fidélité design Stitch + commit conventionnel |
| `/run-pipeline` | Orchestrateur | Pipeline complet : BA → Architecte → **Design (Stitch)** → Backend → Frontend → IA → QA → Review |

### Pipeline `/run-pipeline` — Ordre des étapes avec agents équipe
```
1. /ba          → Agent Business Analyst    : User Story → specs Gherkin
2. /architect   → Agent Architecte          : Contrats API + Prisma + DoD
3. /design      → Agent UX/Stitch           : Écrans Stitch générés/mis à jour + HTML récupéré
4. /backend     → Agent Dev Backend         : Routes API + Prisma + Zod + audit trail + tests unitaires
5. /frontend    → Agent Dev Frontend        : Pages Next.js fidèles aux écrans Stitch
6. /ia          → Agent IA Engineer         : Prompts + analyzeFraud + estimateIndemnization
7. /qa          → Agent QA                  : Vitest + Playwright E2E + coverage ≥ 60%
8. /review      → Agent Release/Review      : Sécurité + perf + design compliance + commit
```

> **Chaque étape est bloquante** : le `/frontend` ne peut pas démarrer sans les écrans Stitch validés à l'étape 3.

### Commandes utilitaires projet
| Commande | Description |
|----------|-------------|
| `/seed` | Reset + reseed BDD (3 users + 10 sinistres) |
| `/test` | Vitest + coverage + diagnostic auto |
| `/migrate` | Nouvelle migration Prisma |
| `/review-route` | Audit checklist d'une route API |
| `/add-route` | Scaffolde une nouvelle route API |
| `/fraud` | Explique le pipeline de détection de fraude |
| `/analyze-claim` | Déclenche l'analyse IA complète sur un sinistre |
| `/design` | Génère/édite les écrans Stitch + récupère le HTML de référence pour le frontend |
| `/mcp` | Informations sur tous les serveurs MCP (barèmes, Playwright, Stitch) |

### Agents spécialisés (`.claude/agents/`)
| Agent | Usage |
|-------|-------|
| `fraud-analyst` | Investigation fraude : corrélations + rapport structuré |
| `qa` | Correction tests + coverage |
| `migration` | Évolution schéma en cascade |
| `feature-dev` | Nouvelle feature full-stack de bout en bout |
| `feature-dev:code-explorer` | Exploration codebase + patterns existants |
| `feature-dev:code-architect` | Blueprint architecture + fichiers à créer/modifier |
| `feature-dev:code-reviewer` | Review code qualité + sécurité + conventions |
| `e2e` | Tests Playwright end-to-end + correction |

### Usage des agents équipe dans `/run-pipeline`
- **`/ba`** → utilise `general-purpose` pour la recherche de specs
- **`/architect`** → utilise `feature-dev:code-architect` pour le blueprint
- **`/design`** → utilise `mcp__stitch__*` pour générer/éditer les écrans
- **`/backend`** → utilise `feature-dev:code-explorer` + `feature-dev:code-architect`
- **`/frontend`** → utilise `feature-dev:code-architect` + HTML Stitch comme référence
- **`/qa`** → utilise agent `qa` + agent `e2e`
- **`/review`** → utilise `feature-dev:code-reviewer`

## Hooks automatiques

| Événement | Déclencheur | Action |
|-----------|-------------|--------|
| Edit/Write | `schema.prisma` | Rappel de migration |
| Edit/Write | `validations.ts` | Rappel de cohérence types |
| Edit/Write | `api/*/route.ts` | Checklist auth+Zod+audit |
| Bash | `migrate reset` sans `--force` | **Bloqué** |
| Bash | `git push --force` | **Bloqué** |
| Bash | `rm -rf` sur répertoires critiques | **Bloqué** |

## Comptes de démonstration
| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Gestionnaire | julie@claimflow.ai | password123 |
| Manager | marc@claimflow.ai | password123 |
| Admin | thomas@claimflow.ai | password123 |

## Variables d'environnement (.env.local)
```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="claimflow-secret-change-in-production-2026"
NEXTAUTH_URL="http://localhost:3000"
GROQ_API_KEY="[CLE_API_GROQ]"            # Provider principal (requis)
ANTHROPIC_API_KEY="[CLE_API_ANTHROPIC]"   # Provider fallback (optionnel)
```
