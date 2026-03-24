import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const UpdateConfigSchema = z.object({
  headerTitle: z.string().min(1).max(200),
  headerSubtitle: z.string().max(300).optional(),
  footerText: z.string().max(500).optional(),
  sections: z.array(z.string()).min(1),
  key: z.string().min(1).default("default"),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  try {
    const config = await prisma.acprReportConfig.findFirst({ orderBy: { updatedAt: "desc" } });
    return NextResponse.json({ data: config });
  } catch (err) {
    console.error("[GET /api/compliance/acpr/config]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé — rôle ADMIN requis" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await prisma.acprReportConfig.findFirst({ orderBy: { updatedAt: "desc" } });

    const { sections, key, ...rest } = parsed.data;
    const sectionsJson = JSON.stringify(sections);

    const config = existing
      ? await prisma.acprReportConfig.update({
          where: { id: existing.id },
          data: { ...rest, sections: sectionsJson, updatedById: session.user.id },
        })
      : await prisma.acprReportConfig.create({
          data: { ...rest, sections: sectionsJson, key, updatedById: session.user.id },
        });

    await createAuditLog({
      action: "ACPR_CONFIG_UPDATED",
      entityType: "AcprReportConfig",
      entityId: config.id,
      after: parsed.data,
      userId: session.user.id,
    });

    return NextResponse.json({ data: config });
  } catch (err) {
    console.error("[PUT /api/compliance/acpr/config]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
