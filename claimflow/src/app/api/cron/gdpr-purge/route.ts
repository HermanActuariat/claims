import { NextRequest, NextResponse } from "next/server";
import { purgeStaleClaims, purgeStaleLogs, purgeWeatherCache } from "@/lib/gdpr-service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);

  try {
    const [claimsPurged, logsPurged, weatherCachePurged] = await Promise.all([
      purgeStaleClaims(cutoffDate, false),
      purgeStaleLogs(cutoffDate, false),
      purgeWeatherCache(false),
    ]);

    return NextResponse.json({
      success: true,
      purgedAt: new Date().toISOString(),
      results: { claimsPurged, logsPurged, weatherCachePurged },
    });
  } catch (err) {
    console.error("[CRON /api/cron/gdpr-purge]", err);
    return NextResponse.json({ error: "Erreur cron GDPR purge" }, { status: 500 });
  }
}
