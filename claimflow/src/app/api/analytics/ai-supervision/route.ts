import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAISupervisionStats } from "@/lib/explainability-service";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  if (!["MANAGER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json(
      { error: "Accès refusé — rôle MANAGER ou ADMIN requis" },
      { status: 403 }
    );
  }

  try {
    const stats = await getAISupervisionStats();
    return NextResponse.json({ data: stats });
  } catch (err) {
    console.error("[analytics/ai-supervision/GET]", err);
    return NextResponse.json(
      { error: "Erreur lors de la récupération des statistiques IA", details: String(err) },
      { status: 500 }
    );
  }
}
