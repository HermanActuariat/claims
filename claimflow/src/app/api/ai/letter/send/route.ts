import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const { claimId, to, subject, body, closing } = await req.json();

    if (!to || !subject || !body) {
      return NextResponse.json({ error: "Paramètres manquants (to, subject, body)" }, { status: 400 });
    }

    const fullBody = `${body}${closing ? `\n\n${closing}` : ""}`;

    // If SMTP is configured, send directly
    if (process.env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text: fullBody,
      });

      if (claimId) {
        await prisma.auditLog.create({
          data: {
            action: "AI_ANALYSIS_RUN",
            entityType: "CLAIM",
            entityId: claimId,
            after: JSON.stringify({ action: "EMAIL_SENT", to, subject }),
            claimId,
            userId: session.user.id,
          },
        });
      }

      return NextResponse.json({ sent: true });
    }

    // No SMTP configured — return mailto URL for client to open
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    return NextResponse.json({ sent: false, mailto });
  } catch (err) {
    console.error("[letter/send]", err);
    return NextResponse.json({ error: "Erreur envoi" }, { status: 500 });
  }
}
