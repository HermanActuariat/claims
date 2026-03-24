import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AILetterSchema } from "@/lib/validations";
import { createAuditLog } from "@/lib/audit";
import Groq from "groq-sdk";
import { LETTER_SYSTEM_PROMPT, letterUserPrompt } from "@/lib/prompts/letter";
import { LetterType } from "@/types";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// Robust JSON extraction: handles markdown code blocks, bare JSON, literal newlines in strings
function extractLetterJSON(text: string, letterType: LetterType) {
  // Strip markdown code block markers
  const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  // 1. Standard JSON parse
  try { return JSON.parse(clean); } catch {}

  // 2. Sanitize literal newlines INSIDE string values, then parse
  // Replaces actual \n chars within quoted strings with \\n escape
  const sanitized = clean.replace(/"(?:[^"\\]|\\.|\n|\r)*"/g, (match) =>
    match.replace(/\r?\n/g, "\\n")
  );
  try { return JSON.parse(sanitized); } catch {}

  // 3. Field-by-field extraction (last resort)
  const subject = extractField(clean, "subject");
  const body = extractField(clean, "body");
  const closing = extractField(clean, "closing");

  if (subject || body) {
    return { subject, body: body || clean, closing, type: letterType };
  }

  // 4. Absolute fallback — show raw text as body so the user sees something
  return { subject: `Courrier ${letterType}`, body: clean, closing: "", type: letterType };
}

// Extract a single JSON string field, handling escaped chars and literal newlines
function extractField(text: string, field: string): string {
  const idx = text.indexOf(`"${field}"`);
  if (idx === -1) return "";
  const colonIdx = text.indexOf(":", idx + field.length + 2);
  if (colonIdx === -1) return "";
  const openIdx = text.indexOf('"', colonIdx + 1);
  if (openIdx === -1) return "";
  // Scan for closing quote (not escaped)
  let pos = openIdx + 1;
  let value = "";
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === "\\" && pos + 1 < text.length) {
      const next = text[pos + 1];
      if (next === "n") value += "\n";
      else if (next === '"') value += '"';
      else if (next === "\\") value += "\\";
      else value += next;
      pos += 2;
    } else if (ch === '"') {
      break;
    } else {
      value += ch;
      pos++;
    }
  }
  return value.trim();
}

// Streaming letter generation — chunks arrive as plain text, ends with __META__
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();

  // Check if client wants streaming
  const streaming = body.stream === true;

  const parsed = AILetterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const claim = await prisma.claim.findUnique({
      where: { id: parsed.data.claimId },
      include: { policyholder: true },
    });
    if (!claim) return NextResponse.json({ error: "Sinistre introuvable" }, { status: 404 });

    const claimData = {
      claimNumber: claim.claimNumber,
      type: claim.type,
      status: claim.status,
      policyholderName: `${claim.policyholder.firstName} ${claim.policyholder.lastName}`,
      policyNumber: claim.policyholder.policyNumber,
      incidentDate: claim.incidentDate,
      estimatedAmount: claim.estimatedAmount,
      approvedAmount: claim.approvedAmount,
    };

    const letterType = parsed.data.letterType as LetterType;
    const start = Date.now();

    if (streaming) {
      // ── Streaming mode ──────────────────────────────────────────────
      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          let fullText = "";

          try {
            const stream = await getGroq().chat.completions.create({
              model: "llama-3.1-8b-instant",
              max_tokens: 600,
              stream: true,
              messages: [
                { role: "system", content: LETTER_SYSTEM_PROMPT(letterType) },
                { role: "user", content: letterUserPrompt(claimData, letterType) },
              ],
            });

            for await (const chunk of stream) {
              const text = chunk.choices[0]?.delta?.content ?? "";
              if (text) {
                fullText += text;
                controller.enqueue(encoder.encode(text));
              }
            }

            // Save to DB after stream completes (non-blocking for the client)
            const durationMs = Date.now() - start;
            const tokensUsed = Math.round(fullText.length / 4);

            // Robust JSON extraction from LLM output
            const result = extractLetterJSON(fullText, letterType);

            // Send metadata at end of stream
            controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ result, durationMs, tokensUsed })}`));

            // Persist async
            Promise.all([
              prisma.aIAnalysis.create({
                data: {
                  type: "LETTER_GENERATION",
                  inputData: JSON.stringify({ claimData, letterType }),
                  outputData: JSON.stringify(result),
                  tokensUsed,
                  durationMs,
                  claimId: claim.id,
                },
              }),
              createAuditLog({
                action: "AI_ANALYSIS_RUN",
                entityType: "CLAIM",
                entityId: claim.id,
                after: { type: "LETTER_GENERATION", letterType },
                claimId: claim.id,
                userId: session.user.id,
              }),
            ]).catch(console.error);

            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`\n__ERROR__${String(err)}`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ── Non-streaming fallback ──────────────────────────────────────────
    const response = await getGroq().chat.completions.create({
      model: "llama-3.1-8b-instant",
      max_tokens: 600,
      messages: [
        { role: "system", content: LETTER_SYSTEM_PROMPT(letterType) },
        { role: "user", content: letterUserPrompt(claimData, letterType) },
      ],
    });

    const durationMs = Date.now() - start;
    const tokensUsed = response.usage?.total_tokens ?? 0;
    const rawText = response.choices[0]?.message?.content ?? "{}";

    const result = extractLetterJSON(rawText, letterType);

    await Promise.all([
      prisma.aIAnalysis.create({
        data: {
          type: "LETTER_GENERATION",
          inputData: JSON.stringify({ claimData, letterType }),
          outputData: JSON.stringify(result),
          tokensUsed,
          durationMs,
          claimId: claim.id,
        },
      }),
      createAuditLog({
        action: "AI_ANALYSIS_RUN",
        entityType: "CLAIM",
        entityId: claim.id,
        after: { type: "LETTER_GENERATION", letterType },
        claimId: claim.id,
        userId: session.user.id,
      }),
    ]);

    return NextResponse.json({ data: { result } });
  } catch (err) {
    console.error("[AI/letter]", err);
    return NextResponse.json({ error: "Erreur génération courrier" }, { status: 500 });
  }
}
