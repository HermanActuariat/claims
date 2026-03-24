import { NextRequest, NextResponse } from "next/server";
import { computePortfolioProvisions } from "@/lib/solvency-service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const qMap: Record<number, string> = { 1: "Q1", 4: "Q2", 7: "Q3", 10: "Q4" };
  const prevQuarterMonth = [1, 4, 7, 10].reduce((prev, m) => (m <= month ? m : prev), 1);
  const prevYear = prevQuarterMonth === 1 && month < 4 ? year - 1 : year;
  const quarter = `${prevYear}-${qMap[prevQuarterMonth]}`;

  try {
    const result = await computePortfolioProvisions(quarter, "ALL", "CRON");

    return NextResponse.json({
      success: true,
      quarter,
      claimCount: result.claimCount,
      totalBE: result.totalBE,
      totalSCR: result.totalSCR,
      totalRM: result.totalRM,
    });
  } catch (err) {
    console.error("[CRON /api/cron/solvency-quarterly]", err);
    return NextResponse.json({ error: "Erreur cron Solvency II" }, { status: 500 });
  }
}
