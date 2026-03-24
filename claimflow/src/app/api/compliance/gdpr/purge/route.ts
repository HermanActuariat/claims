import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";
import { purgeStaleClaims, purgeStaleLogs, purgeWeatherCache } from "@/lib/gdpr-service";
import { z } from "zod";

const PurgeSchema = z.object({
  type: z.enum(["claims", "logs", "weather_cache", "all"]),
  dryRun: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = PurgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  const { type, dryRun } = parsed.data;
  // Données vieilles de plus de 5 ans
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);

  try {
    const results: Record<string, number> = {};

    if (type === "claims" || type === "all") {
      results.claimsPurged = await purgeStaleClaims(cutoffDate, dryRun);
    }
    if (type === "logs" || type === "all") {
      results.logsPurged = await purgeStaleLogs(cutoffDate, dryRun);
    }
    if (type === "weather_cache" || type === "all") {
      results.weatherCachePurged = await purgeWeatherCache(dryRun);
    }

    if (!dryRun) {
      await createAuditLog({
        action: "GDPR_PURGE_EXECUTED",
        entityType: "System",
        entityId: "purge",
        after: { type, cutoffDate: cutoffDate.toISOString(), results },
        userId: session.user.id,
      });
    }

    return NextResponse.json({ data: { dryRun, type, results } }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/compliance/gdpr/purge]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
