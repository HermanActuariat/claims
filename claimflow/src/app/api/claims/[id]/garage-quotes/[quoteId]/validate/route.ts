import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { ValidateGarageQuoteSchema } from "@/lib/validations";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const { id, quoteId } = await params;

  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const quote = await prisma.garageQuote.findFirst({
    where: { id: quoteId, claimId: id },
  });
  if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const body: unknown = await req.json();
  const parsed = ValidateGarageQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { validated } = parsed.data;

  const updated = await prisma.garageQuote.update({
    where: { id: quoteId },
    data: {
      validatedById: validated ? session.user.id : null,
      validatedAt: validated ? new Date() : null,
    },
    include: { lines: true },
  });

  await createAuditLog({
    action: "GARAGE_QUOTE_VALIDATED",
    entityType: "GARAGE_QUOTE",
    entityId: quoteId,
    before: { validatedById: quote.validatedById },
    after: { validatedById: updated.validatedById, validated },
    claimId: id,
    userId: session.user.id,
  });

  return NextResponse.json({
    data: {
      id: updated.id,
      claimId: updated.claimId,
      documentId: updated.documentId,
      garageName: updated.garageName,
      garageCity: updated.garageCity,
      totalAmount: updated.totalAmount,
      extractedByAI: updated.extractedByAI,
      validatedById: updated.validatedById,
      validatedAt: updated.validatedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      lines: updated.lines.map((l) => ({
        id: l.id,
        lineType: l.lineType,
        description: l.description,
        partReference: l.partReference,
        quantity: l.quantity,
        unitPriceHT: l.unitPriceHT,
        laborHours: l.laborHours,
        laborRateHT: l.laborRateHT,
        totalHT: l.totalHT,
        confidence: l.confidence,
      })),
    },
  });
}
