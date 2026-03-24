import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CreateGarageQuoteSchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";
import { extractGarageQuoteLines } from "@/lib/sra-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

  const { id } = await params;

  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const quotes = await prisma.garageQuote.findMany({
    where: { claimId: id },
    include: { lines: true, document: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: quotes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

  const { id } = await params;

  const body = await req.json();
  const parsed = CreateGarageQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Donnees invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const document = await prisma.document.findUnique({ where: { id: parsed.data.documentId } });
  if (!document) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  if (document.claimId !== id) {
    return NextResponse.json({ error: "Le document n'appartient pas a ce sinistre" }, { status: 400 });
  }

  // Check if a quote already exists for this document
  const existingQuote = await prisma.garageQuote.findUnique({ where: { documentId: document.id } });
  if (existingQuote) {
    return NextResponse.json({ error: "Un devis existe deja pour ce document" }, { status: 409 });
  }

  try {
    // Extract lines from document content using AI
    const documentContent = document.ocrData || document.filename;
    const extraction = await extractGarageQuoteLines(documentContent);

    // Create quote + lines in transaction
    const quote = await prisma.$transaction(async (tx) => {
      const garageQuote = await tx.garageQuote.create({
        data: {
          claimId: id,
          documentId: document.id,
          garageName: parsed.data.garageName || extraction.garageName,
          garageCity: parsed.data.garageCity || extraction.garageCity,
          totalAmount: extraction.totalAmount,
          extractedByAI: true,
        },
      });

      if (extraction.lines.length > 0) {
        await tx.garageQuoteLine.createMany({
          data: extraction.lines.map((line) => ({
            quoteId: garageQuote.id,
            lineType: line.lineType,
            description: line.description,
            partReference: line.partReference,
            quantity: line.quantity,
            unitPriceHT: line.unitPriceHT,
            laborHours: line.laborHours,
            laborRateHT: line.laborRateHT,
            totalHT: line.totalHT,
            confidence: line.confidence,
          })),
        });
      }

      return tx.garageQuote.findUnique({
        where: { id: garageQuote.id },
        include: { lines: true },
      });
    });

    await createAuditLog({
      action: "GARAGE_QUOTE_CREATED",
      entityType: "GARAGE_QUOTE",
      entityId: quote!.id,
      after: { quoteId: quote!.id, linesCount: extraction.lines.length },
      claimId: id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: quote }, { status: 201 });
  } catch (err) {
    console.error("[garage-quotes/POST]", err);
    return NextResponse.json({ error: "Erreur creation devis", details: String(err) }, { status: 500 });
  }
}
