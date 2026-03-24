import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ComputeEstimationQuerySchema } from "@/lib/validations";
import { computeBaremeEstimation } from "@/lib/sra-service";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = ComputeEstimationQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { claimId, department } = parsed.data;

  try {
    const result = await computeBaremeEstimation(claimId, department);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Sinistre introuvable") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("[estimation/compute/GET]", err);
    return NextResponse.json({ error: "Erreur de calcul", details: message }, { status: 500 });
  }
}
