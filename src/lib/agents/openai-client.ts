/**
 * OpenAI Client Adapter for Agent System (Phase 4 Modernization)
 * -------------------------------------------------------------
 * Provides 100% backward-compatible interface for legacy callers
 * while delegating internally to the centralized Fleet360 AI Gateway.
 *
 * Benefits:
 *  - Automatic Multi-Provider Fallback (OpenAI -> Gemini -> Anthropic -> Canned Offline)
 *  - In-Memory Response Caching
 *  - Automated Telemetry & Cost Accounting in USD & AED
 */

import { aiGateway, GatewayMessage } from './gateway';
import { ModelCapabilityAlias } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  fromFallback: boolean;
}

/**
 * Single chat completion call delegating through aiGateway.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    fallback?: string;
    capabilityAlias?: ModelCapabilityAlias;
    tenantId?: string;
  } = {},
): Promise<ChatResponse> {
  const gatewayMessages: GatewayMessage[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const res = await aiGateway.chat(gatewayMessages, {
    capabilityAlias: options.capabilityAlias ?? (options.model?.includes('gpt-4o') && !options.model.includes('mini') ? 'STANDARD_REASONING' : 'ECONOMY_TEXT'),
    modelOverride: options.model,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    fallbackText: options.fallback,
    tenantId: options.tenantId,
  });

  return {
    content: res.content,
    model: res.model,
    promptTokens: res.inputTokens,
    completionTokens: res.outputTokens,
    fromFallback: res.fromFallback,
  };
}

/** Quick single-prompt completion — shorthand */
export async function complete(
  systemPrompt: string,
  userPrompt: string,
  options?: Parameters<typeof chatComplete>[1],
): Promise<string> {
  const res = await chatComplete(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    options,
  );
  return res.content;
}
