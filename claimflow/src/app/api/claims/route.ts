import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CreateClaimSchema, ClaimQuerySchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";
import { generateClaimNumber, getVisibleClaimsWhere } from "@/lib/claim-service";

const CLAIM_INCLUDE = {
  policyholder: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  _count: { select: { documents: true, analyses: true, comments: true } },
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const queryResult = ClaimQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!queryResult.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: queryResult.error.flatten() }, { status: 400 });
  }

  const { page, pageSize, status, type, search, assignedToId, dateFrom, dateTo } = queryResult.data;

  try {
    const where = await getVisibleClaimsWhere(session.user.role, session.user.id, {
      status, type, search, assignedToId, dateFrom, dateTo,
    });

    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        include: CLAIM_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.claim.count({ where }),
    ]);

    return NextResponse.json({
      data: claims,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("[GET /api/claims]", err);
    return NextResponse.json({ error: "Erreur lors de la récupération des sinistres" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { thirdPartyInfo, ...claimData } = parsed.data;
    const claimNumber = await generateClaimNumber();

    // Auto-assign to the creator if they are a HANDLER.
    // If MANAGER/ADMIN creates the claim, leave unassigned (they will assign later).
    const assignedToID = session.user.role === "HANDLER" ? session.user.id : null;

    const claim = await prisma.claim.create({
      data: {
        ...claimData,
        incidentDate: new Date(claimData.incidentDate),
        claimNumber,
        thirdPartyInfo: thirdPartyInfo ? JSON.stringify(thirdPartyInfo) : null,
        createdByID: session.user.id,
        ...(assignedToID ? { assignedToID } : {}),
        status: "SUBMITTED",
      },
      include: CLAIM_INCLUDE,
    });

    await createAuditLog({
      action: "CLAIM_CREATED",
      entityType: "CLAIM",
      entityId: claim.id,
      after: { claimNumber: claim.claimNumber, status: claim.status, type: claim.type },
      claimId: claim.id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: claim }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/claims] Error:", err);
    return NextResponse.json(
      { error: "Erreur lors de la création du sinistre" },
      { status: 500 }
    );
  }
}
