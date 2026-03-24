import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { extractGarageQuoteLines } from "@/lib/sra-service";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  void req;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const quotes = await prisma.garageQuote.findMany({
    where: { claimId: id },
    include: { lines: true, document: { select: { filename: true, mimeType: true } } },
    orderBy: { createdAt: "desc" },
  });

  const data = quotes.map((q) => ({
    id: q.id,
    claimId: q.claimId,
    documentId: q.documentId,
    documentName: q.document.filename,
    garageName: q.garageName,
    garageCity: q.garageCity,
    totalAmount: q.totalAmount,
    extractedByAI: q.extractedByAI,
    validatedById: q.validatedById,
    validatedAt: q.validatedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    lines: q.lines.map((l) => ({
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
  }));

  return NextResponse.json({ data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const garageName = formData.get("garageName") as string | null;
  const garageCity = formData.get("garageCity") as string | null;

  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format non autorisé (PDF, JPG, PNG uniquement)" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 });
  }

  // Save file to disk
  const uploadDir = path.join(process.cwd(), "uploads", id);
  await mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.name).replace(/[^.a-zA-Z0-9]/g, "");
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const filepath = path.join(uploadDir, filename);
  const bytes = await file.arrayBuffer();
  await writeFile(filepath, Buffer.from(bytes));

  // Create document entry
  const document = await prisma.document.create({
    data: {
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      url: `/uploads/${id}/${filename}`,
      documentType: "INVOICE",
      claimId: id,
    },
  });

  // Extract quote lines via AI
  let extractedLines: { lineType: string; description: string; partReference: string | null; quantity: number; unitPriceHT: number; laborHours: number | null; laborRateHT: number | null; totalHT: number; confidence: number | null }[] = [];
  let extractedByAI = false;

  try {
    // Read file content for AI extraction (up to ~375KB of actual data)
    const fileBuffer = await readFile(filepath);
    const base64Content = fileBuffer.toString("base64");
    const documentText = file.type === "application/pdf"
      ? `[Document PDF encodé en base64 — nom: ${file.name}]\n${base64Content.substring(0, 500000)}`
      : `[Image encodée en base64 — nom: ${file.name}]\n${base64Content.substring(0, 500000)}`;

    const { result } = await extractGarageQuoteLines(documentText);
    extractedLines = result.map((l) => ({
      lineType: l.lineType,
      description: l.description,
      partReference: l.partReference,
      quantity: l.quantity,
      unitPriceHT: l.unitPriceHT,
      laborHours: l.laborHours,
      laborRateHT: l.laborRateHT,
      totalHT: l.totalHT,
      confidence: l.confidence,
    }));
    extractedByAI = true;
  } catch (err) {
    console.error("[garage-quotes/POST] AI extraction failed:", err);
    // Non-blocking: quote is created without AI-extracted lines
  }

  const totalAmount = extractedLines.reduce((sum, l) => sum + l.totalHT, 0) || null;

  // Create quote + lines in transaction
  try {
    const quote = await prisma.$transaction(async (tx) => {
      const q = await tx.garageQuote.create({
        data: {
          claimId: id,
          documentId: document.id,
          garageName,
          garageCity,
          totalAmount,
          extractedByAI,
        },
      });

      if (extractedLines.length > 0) {
        await tx.garageQuoteLine.createMany({
          data: extractedLines.map((l) => ({
            quoteId: q.id,
            ...l,
          })),
        });
      }

      return tx.garageQuote.findUnique({
        where: { id: q.id },
        include: { lines: true },
      });
    });

    if (!quote) {
      return NextResponse.json({ error: "Erreur lors de la création du devis" }, { status: 500 });
    }

    await createAuditLog({
      action: "GARAGE_QUOTE_UPLOADED",
      entityType: "GARAGE_QUOTE",
      entityId: quote.id,
      after: { garageName, totalAmount, linesCount: extractedLines.length },
      claimId: id,
      userId: session.user.id,
    });

    return NextResponse.json(
      {
        data: {
          id: quote.id,
          claimId: id,
          documentId: document.id,
          garageName: quote.garageName,
          garageCity: quote.garageCity,
          totalAmount: quote.totalAmount,
          extractedByAI: quote.extractedByAI,
          validatedById: null,
          validatedAt: null,
          createdAt: quote.createdAt.toISOString(),
          lines: quote.lines.map((l) => ({
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
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[garage-quotes/POST] Transaction failed:", err);
    return NextResponse.json({ error: "Erreur lors de la création du devis" }, { status: 500 });
  }
}
