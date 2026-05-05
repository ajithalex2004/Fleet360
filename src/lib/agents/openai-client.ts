/**
 * OpenAI Client Helper for Agent System
 * ----------------------------------------
 * Thin wrapper around the OpenAI API.
 * Falls back gracefully when OPENAI_API_KEY is not set
 * (returns a canned statistical-only response).
 *
 * All agents use gpt-4o-mini by default for cost efficiency,
 * with gpt-4o available for critical reasoning tasks.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

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
 * Single chat completion call.
 * Returns { content, model, promptTokens, completionTokens, fromFallback }
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    fallback?: string;  // returned when no API key
  } = {},
): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      content:          options.fallback ?? 'AI analysis unavailable — OPENAI_API_KEY not configured.',
      model:            'fallback',
      promptTokens:     0,
      completionTokens: 0,
      fromFallback:     true,
    };
  }

  const model       = options.model       ?? DEFAULT_MODEL;
  const maxTokens   = options.maxTokens   ?? 512;
  const temperature = options.temperature ?? 0.3;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content:          data.choices[0].message.content.trim(),
    model:            data.model,
    promptTokens:     data.usage.prompt_tokens,
    completionTokens: data.usage.completion_tokens,
    fromFallback:     false,
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
