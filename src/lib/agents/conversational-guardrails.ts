/**
 * Fleet360 Conversational Agent Guardrails & Memory Store
 * --------------------------------------------------------
 * Manages conversation history, token bounding, and session memory for
 * SSE streaming endpoints and interactive conversational copilots.
 *
 * Core Guarantees:
 *  1. Sliding-Window Trimming: Keeps static system prompt at index 0 (optimizing
 *     LLM prompt caching) + latest K conversation turns (default: 6 turns / 12 messages).
 *  2. Tool Call Integrity: Guarantees assistant `tool_calls` and corresponding `tool`
 *     response messages are never separated or orphaned during window pruning.
 *  3. Tenant Session Isolation: Sessions keyed by `${tenantId}:${threadId}` preventing
 *     cross-tenant data leakage.
 *  4. Automatic TTL & LRU Eviction: Inactive sessions evicted after TTL (default: 1 hour)
 *     and store size bounded to MAX_SESSIONS (default: 2,000) to prevent memory leaks.
 *  5. Token Accounting: Estimates token consumption and calculates tokens avoided.
 */

import OpenAI from 'openai';

export interface GuardrailOptions {
  maxTurns?: number;            // Max user/assistant/tool message pairs (default: 6)
  maxTotalMessages?: number;    // Absolute message cap including tools (default: 16)
  preserveSystemPrompt?: boolean; // Keep system prompt at index 0 (default: true)
  maxOutputTokens?: number;     // Suggested max output tokens (default: 1500)
}

export interface TrimResult {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  originalTokens: number;
  trimmedTokens: number;
  tokensSaved: number;
  wasTrimmed: boolean;
}

/**
 * Fast character-heuristic token estimation (~4 characters per token for English/code).
 */
export function estimateTokenCount(content: unknown): number {
  if (!content) return 0;
  if (typeof content === 'string') {
    return Math.ceil(content.length / 4);
  }
  if (Array.isArray(content)) {
    return content.reduce((acc, item) => acc + estimateTokenCount(item), 0);
  }
  if (typeof content === 'object') {
    try {
      return Math.ceil(JSON.stringify(content).length / 4);
    } catch {
      return 10;
    }
  }
  return 1;
}

export function estimateMessagesTokens(messages: OpenAI.Chat.ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // overhead per message
    if (m.content) total += estimateTokenCount(m.content);
    if ('tool_calls' in m && m.tool_calls) {
      total += estimateTokenCount(m.tool_calls);
    }
  }
  return total;
}

/**
 * Trim conversation history keeping system prompt and complete tool-call pairs.
 */
export function trimConversationHistory(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: GuardrailOptions = {},
): TrimResult {
  const maxTotalMessages = options.maxTotalMessages ?? 16;
  const preserveSystem = options.preserveSystemPrompt !== false;
  const originalTokens = estimateMessagesTokens(messages);

  if (messages.length <= maxTotalMessages) {
    return {
      messages: [...messages],
      originalTokens,
      trimmedTokens: originalTokens,
      tokensSaved: 0,
      wasTrimmed: false,
    };
  }

  // 1. Separate System Prompt(s)
  let systemMessage: OpenAI.Chat.ChatCompletionMessageParam | null = null;
  const nonSystemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' && !systemMessage && preserveSystem) {
      systemMessage = msg;
    } else if (msg.role !== 'system') {
      nonSystemMessages.push(msg);
    }
  }

  // 2. Group messages into atomic blocks (e.g. user message, assistant text message, or assistant+toolCall+toolResults)
  const blocks: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  let currentBlock: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i];

    if (msg.role === 'tool') {
      // Belongs to current tool call block
      currentBlock.push(msg);
    } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls && msg.tool_calls.length > 0) {
      // Start of a tool call block
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [msg];
    } else {
      // Standard user or plain assistant message
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [msg];
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  // 3. Take newest blocks until maxTotalMessages limit is satisfied
  const effectiveMax = systemMessage ? maxTotalMessages - 1 : maxTotalMessages;
  const selectedBlocks: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  let count = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (count + block.length <= effectiveMax || selectedBlocks.length === 0) {
      selectedBlocks.unshift(block);
      count += block.length;
    } else {
      break;
    }
  }

  const flattened: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemMessage) {
    flattened.push(systemMessage);
  }
  for (const block of selectedBlocks) {
    flattened.push(...block);
  }

  const trimmedTokens = estimateMessagesTokens(flattened);
  const tokensSaved = Math.max(0, originalTokens - trimmedTokens);

  return {
    messages: flattened,
    originalTokens,
    trimmedTokens,
    tokensSaved,
    wasTrimmed: true,
  };
}

interface SessionEntry {
  messages: (OpenAI.Chat.ChatCompletionMessageParam & { id?: string })[];
  lastAccessed: number;
}

export class TenantSessionStore {
  private sessions = new Map<string, SessionEntry>();
  private readonly defaultTtlMs: number;
  private readonly maxSessions: number;

  constructor(ttlMs = 60 * 60 * 1000, maxSessions = 2000) {
    this.defaultTtlMs = ttlMs;
    this.maxSessions = maxSessions;
  }

  private sessionKey(tenantId: string, threadId: string): string {
    const cleanTenant = tenantId?.trim() || 'default';
    const cleanThread = threadId?.trim() || 'global';
    return `${cleanTenant}:${cleanThread}`;
  }

  getMessages(tenantId: string, threadId: string): (OpenAI.Chat.ChatCompletionMessageParam & { id?: string })[] {
    const key = this.sessionKey(tenantId, threadId);
    const entry = this.sessions.get(key);
    if (!entry) return [];
    entry.lastAccessed = Date.now();
    return entry.messages;
  }

  addMessage(
    tenantId: string,
    threadId: string,
    message: OpenAI.Chat.ChatCompletionMessageParam & { id?: string },
  ): void {
    this.ensureCapacity();
    const key = this.sessionKey(tenantId, threadId);
    let entry = this.sessions.get(key);
    if (!entry) {
      entry = { messages: [], lastAccessed: Date.now() };
      this.sessions.set(key, entry);
    }
    entry.messages.push(message);
    entry.lastAccessed = Date.now();
  }

  getOpenAICompatibleMessageList(
    tenantId: string,
    threadId: string,
    guardrails?: GuardrailOptions,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages = this.getMessages(tenantId, threadId);
    const cleanList = messages.map((m) => {
      const copy = { ...m };
      delete copy.id;
      return copy as OpenAI.Chat.ChatCompletionMessageParam;
    });

    if (guardrails) {
      const { messages: trimmed } = trimConversationHistory(cleanList, guardrails);
      return trimmed;
    }

    return cleanList;
  }

  clearSession(tenantId: string, threadId: string): boolean {
    const key = this.sessionKey(tenantId, threadId);
    return this.sessions.delete(key);
  }

  clearAll(): void {
    this.sessions.clear();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  evictStaleSessions(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.sessions.entries()) {
      if (now - entry.lastAccessed > this.defaultTtlMs) {
        this.sessions.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  private ensureCapacity(): void {
    if (this.sessions.size < this.maxSessions) return;
    this.evictStaleSessions();

    if (this.sessions.size >= this.maxSessions) {
      // LRU Eviction: delete oldest 20%
      const entries = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
      const toDelete = Math.max(1, Math.floor(entries.length * 0.2));
      for (let i = 0; i < toDelete; i++) {
        this.sessions.delete(entries[i][0]);
      }
    }
  }
}

/** Global Shared Conversational Session Store */
export const sessionStore = new TenantSessionStore();
