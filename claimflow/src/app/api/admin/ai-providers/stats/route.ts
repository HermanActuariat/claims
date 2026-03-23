import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProviderStats } from "@/lib/ai-provider";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const stats = await getProviderStats();
  return NextResponse.json({ data: stats });
}
