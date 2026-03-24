import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create users (credentials from TP 00-TP-CLAIMFLOW-AI)
  const sharedPassword = await bcrypt.hash("password123", 10);

  // Cleanup old emails if they exist from previous seeds
  await prisma.user.updateMany({
    where: { email: "admin@claimflow.fr" },
    data: { email: "thomas@claimflow.ai", name: "Thomas Petit" },
  });
  await prisma.user.updateMany({
    where: { email: "manager@claimflow.fr" },
    data: { email: "marc@claimflow.ai", name: "Marc Dubois", password: sharedPassword },
  });
  await prisma.user.updateMany({
    where: { email: "handler@claimflow.fr" },
    data: { email: "julie@claimflow.ai", name: "Julie Martin", password: sharedPassword },
  });

  const admin = await prisma.user.upsert({
    where: { email: "thomas@claimflow.ai" },
    update: { password: sharedPassword, name: "Thomas Petit" },
    create: {
      email: "thomas@claimflow.ai",
      password: sharedPassword,
      name: "Thomas Petit",
      role: "ADMIN",
      active: true,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "marc@claimflow.ai" },
    update: { password: sharedPassword, name: "Marc Dubois" },
    create: {
      email: "marc@claimflow.ai",
      password: sharedPassword,
      name: "Marc Dubois",
      role: "MANAGER",
      active: true,
    },
  });

  const handler = await prisma.user.upsert({
    where: { email: "julie@claimflow.ai" },
    update: { password: sharedPassword, name: "Julie Martin" },
    create: {
      email: "julie@claimflow.ai",
      password: sharedPassword,
      name: "Julie Martin",
      role: "HANDLER",
      active: true,
    },
  });

  console.log("Users created:", { admin: admin.email, manager: manager.email, handler: handler.email });

  // Create policyholders
  const policyholders = await Promise.all([
    prisma.policyholder.upsert({
      where: { policyNumber: "POL-2024-001" },
      update: {},
      create: {
        firstName: "Marie",
        lastName: "Dupont",
        email: "marie.dupont@email.fr",
        phone: "0612345678",
        address: "12 rue de la Paix, 75001 Paris",
        vehicleMake: "Renault",
        vehicleModel: "Clio",
        vehicleYear: 2020,
        vehiclePlate: "AB-123-CD",
        policyNumber: "POL-2024-001",
        contractStart: new Date("2024-01-01"),
        contractEnd: new Date("2025-01-01"),
        coverageType: "COMPREHENSIVE",
      },
    }),
    prisma.policyholder.upsert({
      where: { policyNumber: "POL-2024-002" },
      update: {},
      create: {
        firstName: "Jean",
        lastName: "Martin",
        email: "jean.martin@email.fr",
        phone: "0698765432",
        address: "45 avenue Victor Hugo, 69001 Lyon",
        vehicleMake: "Peugeot",
        vehicleModel: "308",
        vehicleYear: 2019,
        vehiclePlate: "EF-456-GH",
        policyNumber: "POL-2024-002",
        contractStart: new Date("2024-03-01"),
        contractEnd: new Date("2025-03-01"),
        coverageType: "ALL_RISKS",
      },
    }),
    prisma.policyholder.upsert({
      where: { policyNumber: "POL-2024-003" },
      update: {},
      create: {
        firstName: "Sophie",
        lastName: "Bernard",
        email: "sophie.bernard@email.fr",
        phone: "0611223344",
        address: "8 boulevard Gambetta, 13001 Marseille",
        vehicleMake: "BMW",
        vehicleModel: "Serie 3",
        vehicleYear: 2022,
        vehiclePlate: "IJ-789-KL",
        policyNumber: "POL-2024-003",
        contractStart: new Date("2024-11-01"), // Recent - fraud indicator
        contractEnd: new Date("2025-11-01"),
        coverageType: "ALL_RISKS",
      },
    }),
  ]);

  console.log("Policyholders created:", policyholders.length);

  // Cleanup old SIN- prefixed claims from previous seeds
  await prisma.claim.deleteMany({ where: { claimNumber: { startsWith: "SIN-" } } });

  // Helper to generate claim numbers
  let claimSeq = 1;
  const generateClaimNumber = () => {
    const num = String(claimSeq++).padStart(5, "0");
    return `CLM-2026-${num}`;
  };

  // Create claims (10 total, 3 with fraud indicators)
  const claimsData = [
    // Normal claims
    {
      claimNumber: generateClaimNumber(),
      status: "APPROVED",
      type: "GLASS",
      description: "Bris de pare-brise suite à un caillou projeté par un camion sur l'autoroute A6 en direction de Lyon. Le conducteur n'a pas été blessé. Dommages limités au pare-brise uniquement.",
      incidentDate: new Date("2026-01-15"),
      incidentLocation: "Autoroute A6, km 340, direction Lyon",
      thirdPartyInvolved: false,
      estimatedAmount: 450,
      approvedAmount: 420,
      fraudScore: 5,
      fraudRisk: "LOW",
      policyholderID: policyholders[0].id,
      assignedToID: handler.id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "UNDER_REVIEW",
      type: "COLLISION",
      description: "Collision avec un autre véhicule au carrefour de la rue Rivoli et rue de Castiglione. Le tiers adverse a grillé un feu rouge. PV établi par la police. Dommages au pare-chocs avant et aile droite.",
      incidentDate: new Date("2026-02-10"),
      incidentLocation: "Carrefour rue Rivoli / rue de Castiglione, Paris 1er",
      thirdPartyInvolved: true,
      thirdPartyInfo: JSON.stringify({ name: "Pierre Durand", plate: "MN-012-OP", insurance: "AXA" }),
      estimatedAmount: 2800,
      fraudScore: 15,
      fraudRisk: "LOW",
      policyholderID: policyholders[1].id,
      assignedToID: handler.id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "INFO_REQUESTED",
      type: "THEFT",
      description: "Vol total du véhicule dans le parking souterrain de la place Bellecour. Découvert le matin lors de la sortie du travail. Plainte déposée au commissariat du 2ème arrondissement.",
      incidentDate: new Date("2026-01-28"),
      incidentLocation: "Parking souterrain Place Bellecour, Lyon 2ème",
      thirdPartyInvolved: false,
      estimatedAmount: 18000,
      fraudScore: 22,
      fraudRisk: "LOW",
      policyholderID: policyholders[1].id,
      assignedToID: handler.id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "SUBMITTED",
      type: "VANDALISM",
      description: "Actes de vandalisme sur le véhicule garé dans la rue. Rayures profondes sur la carrosserie côté conducteur et côté passager. Rétroviseur gauche cassé. Constaté le matin au réveil.",
      incidentDate: new Date("2026-02-20"),
      incidentLocation: "Rue de la Liberté, Paris 14ème",
      thirdPartyInvolved: false,
      estimatedAmount: 1200,
      fraudScore: 18,
      fraudRisk: "LOW",
      policyholderID: policyholders[0].id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "CLOSED",
      type: "COLLISION",
      description: "Accrochage dans un parking de supermarché. La cliente sortait d'une place lorsqu'un autre véhicule a heurté son pare-chocs arrière. Le tiers a reconnu sa responsabilité sur les lieux.",
      incidentDate: new Date("2025-12-05"),
      incidentLocation: "Parking Carrefour, avenue du Prado, Marseille",
      thirdPartyInvolved: true,
      thirdPartyInfo: JSON.stringify({ name: "Alain Petit", plate: "QR-345-ST" }),
      estimatedAmount: 850,
      approvedAmount: 780,
      fraudScore: 8,
      fraudRisk: "LOW",
      policyholderID: policyholders[2].id,
      assignedToID: manager.id,
      createdByID: handler.id,
    },
    // Normal-ish claim
    {
      claimNumber: generateClaimNumber(),
      status: "APPROVED",
      type: "NATURAL_DISASTER",
      description: "Dommages causés par la tempête du 15 janvier 2026. Grêlons importants ont endommagé la carrosserie (capot, toit). Arbres tombés dans le quartier, témoins multiples.",
      incidentDate: new Date("2026-01-15"),
      incidentLocation: "Rue des Fleurs, Paris 15ème",
      thirdPartyInvolved: false,
      estimatedAmount: 3200,
      approvedAmount: 2900,
      fraudScore: 3,
      fraudRisk: "LOW",
      policyholderID: policyholders[0].id,
      assignedToID: handler.id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "UNDER_REVIEW",
      type: "GLASS",
      description: "Vitre passager avant brisée lors d'une tentative de vol. Aucun vol effectué. Plainte non déposée. Remplacement de la vitre nécessaire.",
      incidentDate: new Date("2026-02-18"),
      incidentLocation: "Parking de l'entreprise, Zone Industrielle Nord, Lyon",
      thirdPartyInvolved: false,
      estimatedAmount: 380,
      fraudScore: 12,
      fraudRisk: "LOW",
      policyholderID: policyholders[1].id,
      assignedToID: handler.id,
      createdByID: handler.id,
    },
    // FRAUD CASES (3 with high fraud scores)
    {
      claimNumber: generateClaimNumber(),
      status: "UNDER_REVIEW",
      type: "THEFT",
      description: "Vol.", // Very short description - fraud indicator
      incidentDate: new Date("2025-10-01"), // Very old - declared late fraud indicator
      incidentLocation: "Zone suspecte, Paris 19ème",
      thirdPartyInvolved: false,
      estimatedAmount: 65000, // Way above vehicle value - fraud indicator
      fraudScore: 87,
      fraudRisk: "CRITICAL",
      policyholderID: policyholders[2].id, // Recently insured - fraud indicator
      assignedToID: manager.id, // Auto-escalated
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "UNDER_REVIEW",
      type: "FIRE",
      description: "Incendie du véhicule à 3h du matin dans une rue isolée. Aucun témoin. Le propriétaire était absent de la ville ce soir-là selon ses dires.",
      incidentDate: new Date("2026-01-22"),
      incidentLocation: "Rue isolée, Zone industrielle, Marseille",
      thirdPartyInvolved: false,
      estimatedAmount: 35000,
      fraudScore: 72,
      fraudRisk: "HIGH",
      policyholderID: policyholders[2].id,
      assignedToID: manager.id,
      createdByID: handler.id,
    },
    {
      claimNumber: generateClaimNumber(),
      status: "REJECTED",
      type: "COLLISION",
      description: "Collision avec un poteau téléphonique. Tiers absent. Aucun témoin. Déclaration effectuée 45 jours après les faits. Dommages structurels importants.",
      incidentDate: new Date("2025-11-20"),
      incidentLocation: "Route nationale 7, secteur rural",
      thirdPartyInvolved: false,
      estimatedAmount: 12000,
      fraudScore: 65,
      fraudRisk: "HIGH",
      policyholderID: policyholders[1].id,
      assignedToID: manager.id,
      createdByID: handler.id,
    },
  ];

  for (const claimData of claimsData) {
    const existing = await prisma.claim.findUnique({ where: { claimNumber: claimData.claimNumber } });
    if (!existing) {
      const claim = await prisma.claim.create({ data: claimData });

      // Add audit log for creation
      await prisma.auditLog.create({
        data: {
          action: "CLAIM_CREATED",
          entityType: "CLAIM",
          entityId: claim.id,
          after: JSON.stringify({ claimNumber: claim.claimNumber, status: claim.status }),
          claimId: claim.id,
          userId: claimData.createdByID,
        },
      });
    }
  }

  console.log("Claims created:", claimsData.length);

  // Default AI Provider Configs
  await prisma.aIProviderConfig.upsert({
    where: { provider: "GROQ" },
    update: {},
    create: { provider: "GROQ", displayName: "Groq (LLaMA)", active: true, priority: 0, apiKeyEnvVar: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
  });
  await prisma.aIProviderConfig.upsert({
    where: { provider: "ANTHROPIC" },
    update: {},
    create: { provider: "ANTHROPIC", displayName: "Anthropic (Claude)", active: false, priority: 1, apiKeyEnvVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-6" },
  });
  await prisma.aIProviderConfig.upsert({
    where: { provider: "OPENAI" },
    update: {},
    create: { provider: "OPENAI", displayName: "OpenAI (GPT)", active: false, priority: 2, apiKeyEnvVar: "OPENAI_API_KEY", defaultModel: "gpt-4o" },
  });
  await prisma.aIProviderConfig.upsert({
    where: { provider: "MISTRAL" },
    update: {},
    create: { provider: "MISTRAL", displayName: "Mistral AI", active: false, priority: 3, apiKeyEnvVar: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest" },
  });
  console.log("AI Provider configs seeded");

  // ─── SRA Bareme initial data ─────────────────────────────────────────────
  await prisma.repairReference.deleteMany({});

  const repairRefs = [
    // BODY
    { category: "BODY", subcategory: "Aile avant", vehicleSegment: "CITY", avgPartCost: 250, avgLaborHours: 3, avgLaborRate: 55 },
    { category: "BODY", subcategory: "Aile avant", vehicleSegment: "SEDAN", avgPartCost: 350, avgLaborHours: 3.5, avgLaborRate: 60 },
    { category: "BODY", subcategory: "Aile avant", vehicleSegment: "SUV", avgPartCost: 450, avgLaborHours: 4, avgLaborRate: 65 },
    { category: "BODY", subcategory: "Aile avant", vehicleSegment: "PREMIUM", avgPartCost: 800, avgLaborHours: 4, avgLaborRate: 85 },
    { category: "BODY", subcategory: "Pare-chocs avant", vehicleSegment: "CITY", avgPartCost: 200, avgLaborHours: 2, avgLaborRate: 55 },
    { category: "BODY", subcategory: "Pare-chocs avant", vehicleSegment: "SEDAN", avgPartCost: 300, avgLaborHours: 2.5, avgLaborRate: 60 },
    { category: "BODY", subcategory: "Pare-chocs avant", vehicleSegment: "SUV", avgPartCost: 400, avgLaborHours: 3, avgLaborRate: 65 },
    { category: "BODY", subcategory: "Pare-chocs avant", vehicleSegment: "PREMIUM", avgPartCost: 700, avgLaborHours: 3, avgLaborRate: 85 },
    { category: "BODY", subcategory: "Porte", vehicleSegment: "CITY", avgPartCost: 300, avgLaborHours: 4, avgLaborRate: 55 },
    { category: "BODY", subcategory: "Porte", vehicleSegment: "SEDAN", avgPartCost: 450, avgLaborHours: 4.5, avgLaborRate: 60 },
    { category: "BODY", subcategory: "Porte", vehicleSegment: "SUV", avgPartCost: 550, avgLaborHours: 5, avgLaborRate: 65 },
    { category: "BODY", subcategory: "Porte", vehicleSegment: "PREMIUM", avgPartCost: 1000, avgLaborHours: 5, avgLaborRate: 85 },
    // MECHANICS
    { category: "MECHANICS", subcategory: "Radiateur", vehicleSegment: "CITY", avgPartCost: 200, avgLaborHours: 2, avgLaborRate: 60 },
    { category: "MECHANICS", subcategory: "Radiateur", vehicleSegment: "SEDAN", avgPartCost: 300, avgLaborHours: 2.5, avgLaborRate: 65 },
    { category: "MECHANICS", subcategory: "Radiateur", vehicleSegment: "SUV", avgPartCost: 400, avgLaborHours: 3, avgLaborRate: 70 },
    { category: "MECHANICS", subcategory: "Radiateur", vehicleSegment: "PREMIUM", avgPartCost: 600, avgLaborHours: 3, avgLaborRate: 90 },
    // GLASS
    { category: "GLASS", subcategory: "Pare-brise", vehicleSegment: "CITY", avgPartCost: 250, avgLaborHours: 1.5, avgLaborRate: 50 },
    { category: "GLASS", subcategory: "Pare-brise", vehicleSegment: "SEDAN", avgPartCost: 350, avgLaborHours: 1.5, avgLaborRate: 55 },
    { category: "GLASS", subcategory: "Pare-brise", vehicleSegment: "SUV", avgPartCost: 450, avgLaborHours: 2, avgLaborRate: 60 },
    { category: "GLASS", subcategory: "Pare-brise", vehicleSegment: "PREMIUM", avgPartCost: 800, avgLaborHours: 2, avgLaborRate: 75 },
    // PAINT
    { category: "PAINT", subcategory: "Element complet", vehicleSegment: "CITY", avgPartCost: 50, avgLaborHours: 4, avgLaborRate: 50 },
    { category: "PAINT", subcategory: "Element complet", vehicleSegment: "SEDAN", avgPartCost: 60, avgLaborHours: 5, avgLaborRate: 55 },
    { category: "PAINT", subcategory: "Element complet", vehicleSegment: "SUV", avgPartCost: 70, avgLaborHours: 5.5, avgLaborRate: 60 },
    { category: "PAINT", subcategory: "Element complet", vehicleSegment: "PREMIUM", avgPartCost: 100, avgLaborHours: 6, avgLaborRate: 80 },
  ];

  const defaultRegionFactor = JSON.stringify({ "75": 1.15, "92": 1.12, "69": 1.05, "13": 1.03, "default": 1.0 });

  for (const ref of repairRefs) {
    await prisma.repairReference.create({
      data: {
        ...ref,
        source: "SRA_OBSERVATOIRE",
        regionFactor: defaultRegionFactor,
        validFrom: new Date("2026-01-01"),
        updatedById: admin.id,
      },
    });
  }
  console.log("SRA Bareme references seeded:", repairRefs.length);

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
