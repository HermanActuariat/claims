import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { SimulateRuleSchema } from "@/lib/validations";
import { simulateRulesForClaim } from "@/lib/rules-engine";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = SimulateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { claimId } = parsed.data;

  try {
    const results = await simulateRulesForClaim(claimId);
    return NextResponse.json({ data: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors de la simulation";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
