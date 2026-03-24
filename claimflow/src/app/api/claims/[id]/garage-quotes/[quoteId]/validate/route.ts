import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ValidateGarageQuoteSchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const { id, quoteId } = await params;

  const quote = await prisma.garageQuote.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  });
  if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
  if (quote.claimId !== id) {
    return NextResponse.json({ error: "Le devis n'appartient pas a ce sinistre" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = ValidateGarageQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Donnees invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  // Apply corrections if any
  if (parsed.data.corrections) {
    for (const correction of parsed.data.corrections) {
      const updateData: Record<string, unknown> = {};
      if (correction.unitPriceHT !== undefined) updateData.unitPriceHT = correction.unitPriceHT;
      if (correction.quantity !== undefined) updateData.quantity = correction.quantity;
      if (correction.laborHours !== undefined) updateData.laborHours = correction.laborHours;
      if (correction.description !== undefined) updateData.description = correction.description;

      // Recalculate totalHT
      const line = quote.lines.find((l) => l.id === correction.lineId);
      if (line) {
        const qty = correction.quantity ?? line.quantity;
        const price = correction.unitPriceHT ?? line.unitPriceHT;
        updateData.totalHT = qty * price;

        await prisma.garageQuoteLine.update({
          where: { id: correction.lineId },
          data: updateData,
        });
      }
    }
  }

  // Recalculate total from lines
  const updatedLines = await prisma.garageQuoteLine.findMany({
    where: { quoteId },
  });
  const newTotal = updatedLines.reduce((sum, l) => sum + l.totalHT, 0);

  const updated = await prisma.garageQuote.update({
    where: { id: quoteId },
    data: {
      validatedById: parsed.data.validated ? session.user.id : null,
      validatedAt: parsed.data.validated ? new Date() : null,
      totalAmount: newTotal,
    },
    include: { lines: true },
  });

  await createAuditLog({
    action: "GARAGE_QUOTE_VALIDATED",
    entityType: "GARAGE_QUOTE",
    entityId: quoteId,
    before: { validatedById: quote.validatedById, totalAmount: quote.totalAmount },
    after: { validatedById: updated.validatedById, totalAmount: updated.totalAmount },
    claimId: id,
    userId: session.user.id,
  });

  return NextResponse.json({ data: updated });
}
