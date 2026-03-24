import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AIExtractSchema } from "@/lib/validations";
import { extractClaimInfo } from "@/lib/ai-service";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = AIExtractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { claimId, description } = parsed.data;
    const { result, tokensUsed, durationMs } = await extractClaimInfo(description);

    const analysis = await prisma.aIAnalysis.create({
      data: {
        type: "EXTRACTION",
        inputData: JSON.stringify({ description }),
        outputData: JSON.stringify(result),
        tokensUsed,
        durationMs,
        claimId,
      },
    });

    await createAuditLog({
      action: "AI_ANALYSIS_RUN",
      entityType: "CLAIM",
      entityId: claimId,
      after: { type: "EXTRACTION", tokensUsed },
      claimId,
      userId: session.user.id,
    });

    return NextResponse.json({ data: { analysis, result } });
  } catch (err) {
    console.error("[AI/extract]", err);
    return NextResponse.json({ error: "Erreur analyse IA" }, { status: 500 });
  }
}
