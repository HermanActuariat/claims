import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OcrRequestSchema } from "@/lib/validations";
import { extractTextFromImage } from "@/lib/ocr-service";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = OcrRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { documentId } = parsed.data;

    // Verify document exists and user has access
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { claim: { select: { id: true } } },
    });

    if (!document) {
      return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    }

    const { result, tokensUsed, durationMs } = await extractTextFromImage(documentId);

    await createAuditLog({
      action: "OCR_EXTRACTED",
      entityType: "DOCUMENT",
      entityId: documentId,
      after: {
        ocrExtracted: true,
        ocrConfidence: result.confidence,
        tokensUsed,
        durationMs,
      },
      claimId: document.claim.id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[AI/ocr]", err);
    return NextResponse.json(
      { error: "Erreur extraction OCR", details: String(err) },
      { status: 500 }
    );
  }
}
