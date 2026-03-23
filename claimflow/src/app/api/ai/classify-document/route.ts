import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ClassifyDocumentSchema } from "@/lib/validations";
import { classifyDocument } from "@/lib/document-classifier";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = ClassifyDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { documentId } = parsed.data;

    // Verify document exists
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { claim: { select: { id: true } } },
    });

    if (!document) {
      return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    }

    const result = await classifyDocument(documentId);

    await createAuditLog({
      action: "DOCUMENT_CLASSIFIED",
      entityType: "DOCUMENT",
      entityId: documentId,
      after: {
        documentType: result.documentType,
        confidence: result.confidence,
        reasoning: result.reasoning,
      },
      claimId: document.claim.id,
      userId: session.user.id,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[AI/classify-document]", err);
    return NextResponse.json(
      { error: "Erreur classification document", details: String(err) },
      { status: 500 }
    );
  }
}
