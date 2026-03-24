/**
 * Multi-Provider AI abstraction with circuit breaker and fallback.
 * Active provider: Groq (LLaMA). Others are inactive stubs for MVP.
 */

import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { AIProviderType } from "@/types";

// ─── Adapter Interface ────────────────────────────────────────────────────────

export interface AIProviderAdapter {
  name: AIProviderType;
  chat(params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    model?: string;
  }): Promise<{ text: string; tokensUsed: number }>;
}

// ─── Groq Adapter ─────────────────────────────────────────────────────────────

const GROQ_MODEL = "llama-3.3-70b-versatile";

let _groqClient: Groq | null = null;
function getGroqClient(): Groq {
  if (!_groqClient) {
    _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groqClient;
}

export function createGroqAdapter(): AIProviderAdapter {
  return {
    name: "GROQ",
    async chat({ systemPrompt, userPrompt, maxTokens, model }) {
      const response = await getGroqClient().chat.completions.create({
        model: model ?? GROQ_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content || content.trim() === "") {
        throw new Error("AI provider returned empty response — possible rate limit or content filter");
      }
      const tokensUsed = response.usage?.total_tokens ?? 0;
      return { text: content, tokensUsed };
    },
  };
}

// ─── Stub Adapters (inactive for MVP) ────────────────────────────────────────

export function createAnthropicAdapter(): AIProviderAdapter {
  return {
    name: "ANTHROPIC",
    async chat(_params) {
      throw new Error("Provider ANTHROPIC not configured");
    },
  };
}

export function createOpenAIAdapter(): AIProviderAdapter {
  return {
    name: "OPENAI",
    async chat(_params) {
      throw new Error("Provider OPENAI not implemented");
    },
  };
}

export function createMistralAdapter(): AIProviderAdapter {
  return {
    name: "MISTRAL",
    async chat(_params) {
      throw new Error("Provider MISTRAL not implemented");
    },
  };
}

function getAdapter(provider: AIProviderType): AIProviderAdapter {
  switch (provider) {
    case "GROQ":
      return createGroqAdapter();
    case "ANTHROPIC":
      return createAnthropicAdapter();
    case "OPENAI":
      return createOpenAIAdapter();
    case "MISTRAL":
      return createMistralAdapter();
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailure: number | null;
  isOpen: boolean;
}

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(provider: string): CircuitBreakerState {
  if (!circuitBreakers.has(provider)) {
    circuitBreakers.set(provider, { failures: 0, lastFailure: null, isOpen: false });
  }
  return circuitBreakers.get(provider) as CircuitBreakerState;
}

export function recordSuccess(provider: string): void {
  const state = getCircuitBreaker(provider);
  state.failures = 0;
  state.lastFailure = null;
  state.isOpen = false;
}

export function recordFailure(provider: string): void {
  const state = getCircuitBreaker(provider);
  state.failures += 1;
  state.lastFailure = Date.now();
  if (state.failures >= FAILURE_THRESHOLD) {
    state.isOpen = true;
  }
}

export function isCircuitOpen(provider: string): boolean {
  const state = getCircuitBreaker(provider);
  if (!state.isOpen) return false;
  // Auto-reset after cooldown
  if (state.lastFailure !== null && Date.now() - state.lastFailure >= COOLDOWN_MS) {
    state.isOpen = false;
    state.failures = 0;
    state.lastFailure = null;
    return false;
  }
  return true;
}

// ─── Active Providers ─────────────────────────────────────────────────────────

import { AIProviderConfig } from "@prisma/client";

export async function getActiveProviders(): Promise<AIProviderConfig[]> {
  return prisma.aIProviderConfig.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });
}

// ─── callWithFallback ─────────────────────────────────────────────────────────

export async function callWithFallback(params: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<{
  text: string;
  tokensUsed: number;
  provider: string;
  model: string;
  durationMs: number;
}> {
  const providers = await getActiveProviders();

  if (providers.length === 0) {
    throw new Error("Aucun provider IA actif configuré");
  }

  for (const config of providers) {
    const providerName = config.provider as AIProviderType;

    if (isCircuitOpen(config.provider)) {
      continue;
    }

    const adapter = getAdapter(providerName);
    const model = config.defaultModel;
    const maxTokens = Math.min(params.maxTokens, config.maxTokens);
    const start = Date.now();

    try {
      const { text, tokensUsed } = await adapter.chat({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        maxTokens,
        model,
      });

      const durationMs = Date.now() - start;
      recordSuccess(config.provider);

      // Log success to AIProviderLog
      await prisma.aIProviderLog.create({
        data: {
          provider: config.provider,
          model,
          success: true,
          tokensUsed,
          durationMs,
        },
      });

      return { text, tokensUsed, provider: config.provider, model, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      recordFailure(config.provider);

      // Log failure to AIProviderLog
      await prisma.aIProviderLog.create({
        data: {
          provider: config.provider,
          model,
          success: false,
          tokensUsed: 0,
          durationMs,
          errorMessage,
        },
      });
    }
  }

  throw new Error("Tous les providers IA sont indisponibles");
}

// ─── Provider Stats ───────────────────────────────────────────────────────────

export async function getProviderStats(): Promise<
  {
    provider: string;
    totalCalls: number;
    successRate: number;
    avgDurationMs: number;
    circuitOpen: boolean;
  }[]
> {
  const logs = await prisma.aIProviderLog.findMany({
    select: {
      provider: true,
      success: true,
      durationMs: true,
    },
  });

  const grouped = new Map<
    string,
    { total: number; successes: number; totalDuration: number }
  >();

  for (const log of logs) {
    const entry = grouped.get(log.provider) ?? {
      total: 0,
      successes: 0,
      totalDuration: 0,
    };
    entry.total += 1;
    if (log.success) entry.successes += 1;
    entry.totalDuration += log.durationMs;
    grouped.set(log.provider, entry);
  }

  return Array.from(grouped.entries()).map(([provider, stats]) => ({
    provider,
    totalCalls: stats.total,
    successRate: stats.total > 0 ? stats.successes / stats.total : 0,
    avgDurationMs: stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0,
    circuitOpen: isCircuitOpen(provider),
  }));
}
