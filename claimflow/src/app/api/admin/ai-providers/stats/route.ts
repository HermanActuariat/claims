import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProviderStats } from "@/lib/ai-provider";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const stats = await getProviderStats();
    return NextResponse.json({ data: stats });
  } catch (err) {
    console.error("[admin/ai-providers/stats/GET]", err);
    return NextResponse.json(
      { error: "Erreur lors de la récupération des statistiques", details: String(err) },
      { status: 500 }
    );
  }
}
