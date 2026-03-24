import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { EstimationComputeSchema } from "@/lib/validations";
import { computeSRAEstimation } from "@/lib/sra-service";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = EstimationComputeSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Parametres invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await computeSRAEstimation(parsed.data.claimId, parsed.data.department);

    await createAuditLog({
      action: "SRA_ESTIMATION_COMPUTED",
      entityType: "CLAIM",
      entityId: parsed.data.claimId,
      after: { estimatedTotal: result.estimatedTotal, source: result.source },
      claimId: parsed.data.claimId,
      userId: session.user.id,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[estimation/compute]", err);
    return NextResponse.json({ error: "Erreur estimation" }, { status: 500 });
  }
}
