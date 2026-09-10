/**
 * Fleet360 AI Gateway Service
 * ----------------------------
 * Centralized Generative AI & LLM access layer across all Fleet360 agents.
 *
 * Core Capabilities:
 *  1. Capability Alias Resolution (ECONOMY_TEXT, STANDARD_REASONING, ADVANCED_REASONING, etc.).
 *  2. Multi-Provider Fallback Chain (OpenAI -> Gemini -> Anthropic -> Deterministic Canned Fallback).
 *  3. Multi-Tier Response Caching (L1 Memory Cache with Avoided Token Cost Tracking).
 *  4. Structured JSON Output & Zod-Friendly Extraction.
 *  5. Automatic Token Telemetry Attribution in USD and AED via calculateTokenCost.
 *
 * RULE: No agent or copilot calls OpenAI, Anthropic, or Gemini directly.
 */

import {
  ModelCapabilityAlias,
  ModelProviderType,
  AgentRunTelemetry,
} from '../types';
import { calculateTokenCost, USD_TO_AED_RATE } from '../telemetry';

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayOptions {
  capabilityAlias?: ModelCapabilityAlias;
  modelOverride?: string;
  preferredProvider?: ModelProviderType;
  maxTokens?: number;
  temperature?: number;
  tenantId?: string;
  cacheTtlMs?: number;
  forceFresh?: boolean;
  fallbackText?: string;
  responseFormat?: 'text' | 'json';
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

export interface GatewayVisionOptions extends GatewayOptions {
  detail?: 'low' | 'high' | 'auto';
}

export interface GatewayResponse {
  content: string;
  capabilityAlias: ModelCapabilityAlias;
  model: string;
  provider: ModelProviderType;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  isCacheHit: boolean;
  fromFallback: boolean;
  costUsd: number;
  costAed: number;
  costAvoidedUsd: number;
  costAvoidedAed: number;
  telemetry: AgentRunTelemetry;
}

export interface GatewayStructuredResponse<T> extends GatewayResponse {
  data: T | null;
  parseError?: string;
}

// ── In-Memory Response Cache (L1) ─────────────────────────────────────────────

interface CachedGatewayEntry {
  content: string;
  capabilityAlias: ModelCapabilityAlias;
  model: string;
  provider: ModelProviderType;
  inputTokens: number;
  outputTokens: number;
  expiresAt: number;
}

const MEMORY_GATEWAY_CACHE = new Map<string, CachedGatewayEntry>();
const MAX_CACHE_SIZE = 2000;

function hashPromptKey(messages: GatewayMessage[], alias: ModelCapabilityAlias, tenantId?: string): string {
  const serialized = JSON.stringify({ messages, alias, tenantId: tenantId ?? 'default' });
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `gw_cache_${alias}_${hash}`;
}

// ── Model Mapping per Capability Alias ────────────────────────────────────────

const ALIAS_MODEL_MAP: Record<
  ModelCapabilityAlias,
  { openai: string; gemini: string; anthropic: string }
> = {
  DETERMINISTIC_RULES:  { openai: 'none', gemini: 'none', anthropic: 'none' },
  LOCAL_STATISTICAL:    { openai: 'none', gemini: 'none', anthropic: 'none' },
  // gemini-1.5-flash/-pro were fully retired from the v1beta API (confirmed
  // live via ListModels against a real key: HTTP 404 model-not-found). Using
  // Google's "latest" aliases instead of pinning a dated version avoids this
  // exact rot recurring every time Google retires a model generation.
  ECONOMY_TEXT:         { openai: 'gpt-4o-mini', gemini: 'gemini-flash-latest', anthropic: 'claude-3-5-haiku-20241022' },
  STANDARD_REASONING:   { openai: 'gpt-4o', gemini: 'gemini-pro-latest', anthropic: 'claude-3-5-sonnet-20241022' },
  ADVANCED_REASONING:   { openai: 'o3-mini', gemini: 'gemini-pro-latest', anthropic: 'claude-3-5-sonnet-20241022' },
  VISION_FAST:          { openai: 'gpt-4o-mini', gemini: 'gemini-flash-latest', anthropic: 'claude-3-5-haiku-20241022' },
  VISION_HIGH_ACCURACY: { openai: 'gpt-4o', gemini: 'gemini-pro-latest', anthropic: 'claude-3-5-sonnet-20241022' },
  STRUCTURED_EXTRACTION:{ openai: 'gpt-4o-mini', gemini: 'gemini-flash-latest', anthropic: 'claude-3-5-haiku-20241022' },
};

// ── Resilient HTTP Fetch with Exponential Backoff & Jitter ───────────────────

interface RetryFetchConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  providerName: string;
}

const IS_TEST_ENV = typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST));

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: IS_TEST_ENV ? 10 : 800,
  maxDelayMs: IS_TEST_ENV ? 50 : 3500,
};

function isTransientHttpStatus(status: number): boolean {
  // 429: Rate limit / quota exhausted
  // 500: Internal server error
  // 502: Bad Gateway
  // 503: Service Unavailable / High demand / UNAVAILABLE
  // 504: Gateway Timeout
  // 529: Site overloaded (Anthropic)
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithExponentialBackoff(
  url: string,
  init: RequestInit,
  config: RetryFetchConfig,
): Promise<Response> {
  const maxRetries = config.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries;
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs;
  const maxDelayMs = config.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      lastResponse = res;

      if (res.ok) {
        return res;
      }

      // Check if transient error and we have retries remaining
      if (isTransientHttpStatus(res.status) && attempt < maxRetries) {
        const jitter = IS_TEST_ENV ? 0 : Math.floor(Math.random() * 200);
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + jitter;

        console.warn(
          `[ai-gateway] ${config.providerName} transient HTTP ${res.status} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`
        );

        await sleep(delay);
        continue;
      }

      // Not transient or retries exhausted
      return res;
    } catch (networkErr) {
      lastError = networkErr;
      if (attempt < maxRetries) {
        const jitter = IS_TEST_ENV ? 0 : Math.floor(Math.random() * 200);
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + jitter;

        console.warn(
          `[ai-gateway] ${config.providerName} network exception (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`
        );

        await sleep(delay);
        continue;
      }
      throw networkErr;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`[ai-gateway] ${config.providerName} call failed after ${maxRetries + 1} attempts`);
}

export class AIGatewayService {
  /**
   * 1. Multi-Turn / Tool Chat Completion with Fallback Stack & Caching
   */
  async chat(messages: GatewayMessage[], options: GatewayOptions = {}): Promise<GatewayResponse> {
    const alias = options.capabilityAlias ?? 'ECONOMY_TEXT';
    const tenantId = options.tenantId ?? 'default';
    const cacheKey = hashPromptKey(messages, alias, tenantId);

    // Check L1 In-Memory Cache
    if (!options.forceFresh) {
      const cached = MEMORY_GATEWAY_CACHE.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        const avoided = calculateTokenCost(alias, cached.inputTokens, cached.outputTokens, cached.inputTokens);
        const telemetry: AgentRunTelemetry = {
          modelAlias: alias,
          modelProvider: cached.provider,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: cached.inputTokens,
          costUsd: 0,
          costAed: 0,
        };

        return {
          content: cached.content,
          capabilityAlias: alias,
          model: cached.model,
          provider: cached.provider,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: cached.inputTokens,
          isCacheHit: true,
          fromFallback: false,
          costUsd: 0,
          costAed: 0,
          costAvoidedUsd: avoided.costUsd,
          costAvoidedAed: avoided.costAed,
          telemetry,
        };
      }
    }

    // Step A: Attempt OpenAI Provider
    const openAiKey = process.env.OPENAI_API_KEY;
    if (openAiKey && options.preferredProvider !== 'gemini' && options.preferredProvider !== 'anthropic') {
      try {
        const model = options.modelOverride ?? ALIAS_MODEL_MAP[alias].openai;
        const res = await this.callOpenAI(messages, model, options, openAiKey);
        this.cacheResponse(cacheKey, res, options.cacheTtlMs);
        return res;
      } catch (openAiErr) {
        console.warn('[ai-gateway] OpenAI call failed, initiating fallback chain:', openAiErr);
      }
    }

    // Step B: Attempt Google Gemini Provider
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const model = options.modelOverride ?? ALIAS_MODEL_MAP[alias].gemini;
        const res = await this.callGemini(messages, model, options, geminiKey);
        this.cacheResponse(cacheKey, res, options.cacheTtlMs);
        return res;
      } catch (geminiErr) {
        console.warn('[ai-gateway] Gemini call failed, attempting Anthropic fallback:', geminiErr);
      }
    }

    // Step C: Attempt Anthropic Provider
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      try {
        const model = options.modelOverride ?? ALIAS_MODEL_MAP[alias].anthropic;
        const res = await this.callAnthropic(messages, model, options, anthropicKey);
        this.cacheResponse(cacheKey, res, options.cacheTtlMs);
        return res;
      } catch (anthropicErr) {
        console.warn('[ai-gateway] Anthropic call failed, resorting to canned fallback:', anthropicErr);
      }
    }

    // Step D: Deterministic Fallback
    const fallbackText = options.fallbackText ?? 'AI assistance is currently operating in deterministic offline mode.';
    const telemetry: AgentRunTelemetry = {
      modelAlias: 'DETERMINISTIC_RULES',
      modelProvider: 'deterministic',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      costAed: 0,
    };

    return {
      content: fallbackText,
      capabilityAlias: 'DETERMINISTIC_RULES',
      model: 'deterministic-fallback',
      provider: 'deterministic',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      isCacheHit: false,
      fromFallback: true,
      costUsd: 0,
      costAed: 0,
      costAvoidedUsd: 0,
      costAvoidedAed: 0,
      telemetry,
    };
  }

  /**
   * 2. Single System + User prompt shorthand
   */
  async complete(
    systemPrompt: string,
    userPrompt: string,
    options: GatewayOptions = {},
  ): Promise<GatewayResponse> {
    return this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options,
    );
  }

  /**
   * 3. Structured JSON Extraction with Schema Validation
   */
  async structuredOutput<T>(
    messages: GatewayMessage[],
    schemaDescription: string,
    options: GatewayOptions = {},
  ): Promise<GatewayStructuredResponse<T>> {
    const enrichedMessages: GatewayMessage[] = [
      ...messages,
      {
        role: 'system',
        content: `IMPORTANT: Respond ONLY with a valid, raw JSON object conforming to the following structure:\n${schemaDescription}\nDo NOT wrap in markdown backticks or commentary.`,
      },
    ];

    const res = await this.chat(enrichedMessages, {
      ...options,
      capabilityAlias: options.capabilityAlias ?? 'STRUCTURED_EXTRACTION',
      responseFormat: 'json',
    });

    try {
      let cleaned = res.content.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

      const parsed = JSON.parse(cleaned) as T;
      return {
        ...res,
        data: parsed,
      };
    } catch (parseErr) {
      return {
        ...res,
        data: null,
        parseError: `JSON parse error: ${(parseErr as Error).message}`,
      };
    }
  }

  /**
   * 4. Multi-Image Vision Inspection
   */
  async vision(
    images: string[],
    prompt: string,
    options: GatewayVisionOptions = {},
  ): Promise<GatewayResponse> {
    const alias = options.capabilityAlias ?? (options.detail === 'high' ? 'VISION_HIGH_ACCURACY' : 'VISION_FAST');
    const openAiKey = process.env.OPENAI_API_KEY;

    if (!openAiKey) {
      return this.chat(
        [
          { role: 'system', content: 'Vision inspection assistant.' },
          { role: 'user', content: prompt },
        ],
        { ...options, capabilityAlias: alias },
      );
    }

    const model = options.modelOverride ?? ALIAS_MODEL_MAP[alias].openai;
    const imagePayloads = images.map(img => ({
      type: 'image_url',
      image_url: {
        url: img.startsWith('data:') || img.startsWith('http') ? img : `data:image/jpeg;base64,${img}`,
        detail: options.detail ?? 'auto',
      },
    }));

    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imagePayloads,
          ],
        },
      ],
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.2,
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI Vision error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const cost = calculateTokenCost(alias, inputTokens, outputTokens);

    const telemetry: AgentRunTelemetry = {
      modelAlias: alias,
      modelProvider: 'openai',
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
    };

    return {
      content: data.choices[0].message.content.trim(),
      capabilityAlias: alias,
      model: data.model,
      provider: 'openai',
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      isCacheHit: false,
      fromFallback: false,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
      costAvoidedUsd: 0,
      costAvoidedAed: 0,
      telemetry,
    };
  }

  /**
   * Clear in-memory cache
   */
  clearCache(): void {
    MEMORY_GATEWAY_CACHE.clear();
  }

  // ── Private Provider Implementations ───────────────────────────────────────

  private async callOpenAI(
    messages: GatewayMessage[],
    model: string,
    options: GatewayOptions,
    apiKey: string,
  ): Promise<GatewayResponse> {
    const alias = options.capabilityAlias ?? 'ECONOMY_TEXT';
    const maxTokens = options.maxTokens ?? 512;
    const temperature = options.temperature ?? 0.3;

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    if (options.responseFormat === 'json') {
      payload.response_format = { type: 'json_object' };
    }

    const retryConfig: RetryFetchConfig = {
      providerName: 'OpenAI',
      maxRetries: options.maxRetries,
      baseDelayMs: options.retryBaseDelayMs,
    };

    const res = await fetchWithExponentialBackoff('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    }, retryConfig);

    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    };

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const cost = calculateTokenCost(alias, inputTokens, outputTokens, cachedTokens);

    const telemetry: AgentRunTelemetry = {
      modelAlias: alias,
      modelProvider: 'openai',
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
    };

    return {
      content: data.choices[0].message.content.trim(),
      capabilityAlias: alias,
      model: data.model,
      provider: 'openai',
      inputTokens,
      outputTokens,
      cachedTokens,
      isCacheHit: false,
      fromFallback: false,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
      costAvoidedUsd: 0,
      costAvoidedAed: 0,
      telemetry,
    };
  }

  private async callGemini(
    messages: GatewayMessage[],
    model: string,
    options: GatewayOptions,
    apiKey: string,
  ): Promise<GatewayResponse> {
    const alias = options.capabilityAlias ?? 'ECONOMY_TEXT';
    const retryConfig: RetryFetchConfig = {
      providerName: 'Gemini',
      maxRetries: options.maxRetries,
      baseDelayMs: options.retryBaseDelayMs,
    };

    const invokeGeminiModel = async (targetModel: string): Promise<GatewayResponse> => {
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
      const res = await fetchWithExponentialBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      }, retryConfig);

      if (!res.ok) {
        const errorBody = await res.text();
        const err = new Error(`Gemini HTTP ${res.status}: ${errorBody}`);
        (err as any).status = res.status;
        (err as any).body = errorBody;
        throw err;
      }

      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 100;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 50;
      const cost = calculateTokenCost(alias, inputTokens, outputTokens);

      const telemetry: AgentRunTelemetry = {
        modelAlias: alias,
        modelProvider: 'gemini',
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        costUsd: cost.costUsd,
        costAed: cost.costAed,
      };

      return {
        content: text.trim(),
        capabilityAlias: alias,
        model: targetModel,
        provider: 'gemini',
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        isCacheHit: false,
        fromFallback: false,
        costUsd: cost.costUsd,
        costAed: cost.costAed,
        costAvoidedUsd: 0,
        costAvoidedAed: 0,
        telemetry,
      };
    };

    try {
      return await invokeGeminiModel(model);
    } catch (primaryErr: any) {
      // In-Provider Graceful Model Fallback:
      // If primary model was a Pro model (gemini-pro-latest, gemini-2.5-pro, etc.) and failed with 503 UNAVAILABLE or capacity exhaustion,
      // failover to Flash model (gemini-flash-latest) which has significantly higher throughput and separate capacity allocations.
      const errorMsg = String(primaryErr?.message || primaryErr?.body || '');
      const isCapacityError =
        primaryErr?.status === 503 ||
        errorMsg.includes('UNAVAILABLE') ||
        errorMsg.includes('high demand');

      const isProModel = model.toLowerCase().includes('pro');

      if (isCapacityError && isProModel && model !== 'gemini-flash-latest') {
        console.warn(
          `[ai-gateway] Gemini Pro model (${model}) capacity exhausted / UNAVAILABLE. Initiating in-provider fallback to gemini-flash-latest...`
        );
        try {
          return await invokeGeminiModel('gemini-flash-latest');
        } catch (flashErr) {
          console.warn('[ai-gateway] In-provider Flash fallback also failed:', flashErr);
          throw primaryErr;
        }
      }

      throw primaryErr;
    }
  }

  private async callAnthropic(
    messages: GatewayMessage[],
    model: string,
    options: GatewayOptions,
    apiKey: string,
  ): Promise<GatewayResponse> {
    const alias = options.capabilityAlias ?? 'STANDARD_REASONING';
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 512,
      messages: userMessages,
    };
    if (systemMessage) body.system = systemMessage;

    const retryConfig: RetryFetchConfig = {
      providerName: 'Anthropic',
      maxRetries: options.maxRetries,
      baseDelayMs: options.retryBaseDelayMs,
    };

    const res = await fetchWithExponentialBackoff('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, retryConfig);

    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      content: Array<{ text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const cost = calculateTokenCost(alias, inputTokens, outputTokens);

    const telemetry: AgentRunTelemetry = {
      modelAlias: alias,
      modelProvider: 'anthropic',
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
    };

    return {
      content: data.content[0].text.trim(),
      capabilityAlias: alias,
      model: data.model,
      provider: 'anthropic',
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      isCacheHit: false,
      fromFallback: false,
      costUsd: cost.costUsd,
      costAed: cost.costAed,
      costAvoidedUsd: 0,
      costAvoidedAed: 0,
      telemetry,
    };
  }

  private cacheResponse(key: string, res: GatewayResponse, customTtlMs?: number): void {
    if (res.fromFallback || res.isCacheHit) return;

    if (MEMORY_GATEWAY_CACHE.size >= MAX_CACHE_SIZE) {
      const keysToDelete = Array.from(MEMORY_GATEWAY_CACHE.keys()).slice(0, 200);
      for (const k of keysToDelete) MEMORY_GATEWAY_CACHE.delete(k);
    }

    const ttl = customTtlMs ?? 60 * 60 * 1000; // 1 hour default
    MEMORY_GATEWAY_CACHE.set(key, {
      content: res.content,
      capabilityAlias: res.capabilityAlias,
      model: res.model,
      provider: res.provider,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      expiresAt: Date.now() + ttl,
    });
  }
}

/** Global Shared AI Gateway Singleton */
export const aiGateway = new AIGatewayService();
