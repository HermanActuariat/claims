import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { EstimationComputeSchema } from "@/lib/validations";
import { computeSRAEstimation } from "@/lib/sra-service";

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
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[estimation/compute]", err);
    return NextResponse.json({ error: "Erreur estimation", details: String(err) }, { status: 500 });
  }
}
