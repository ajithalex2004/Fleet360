import { describe, it, expect, beforeEach } from 'vitest';
import OpenAI from 'openai';
import {
  trimConversationHistory,
  estimateTokenCount,
  estimateMessagesTokens,
  TenantSessionStore,
  sessionStore,
} from '@/lib/agents/conversational-guardrails';
import { getMessageStore } from '@/app/api/chat/messageStore';

describe('Phase 6: Conversational Agent Cost Controls & SSE Streaming Guardrails', () => {
  beforeEach(() => {
    sessionStore.clearAll();
  });

  describe('Token Estimation Heuristics', () => {
    it('estimates character tokens accurately', () => {
      const text = 'Hello world from Fleet360';
      const tokens = estimateTokenCount(text);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('estimates full messages list tokens including tool calls and overhead', () => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are the Fleet360 Ops Assistant.' },
        { role: 'user', content: 'Show all available vehicles in Dubai.' },
      ];
      const tokens = estimateMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(15);
    });
  });

  describe('Sliding-Window Message Trimming', () => {
    it('does not trim messages when total message count is within limit', () => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are an ops assistant.' },
        { role: 'user', content: 'Turn 1' },
        { role: 'assistant', content: 'Reply 1' },
      ];

      const res = trimConversationHistory(messages, { maxTotalMessages: 10 });
      expect(res.wasTrimmed).toBe(false);
      expect(res.messages.length).toBe(3);
      expect(res.tokensSaved).toBe(0);
    });

    it('preserves system prompt at index 0 and prunes oldest user/assistant turns', () => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are the Fleet360 Ops Assistant.' },
        { role: 'user', content: 'Turn 1: Old question' },
        { role: 'assistant', content: 'Turn 1: Old answer' },
        { role: 'user', content: 'Turn 2: Mid question' },
        { role: 'assistant', content: 'Turn 2: Mid answer' },
        { role: 'user', content: 'Turn 3: Recent question' },
        { role: 'assistant', content: 'Turn 3: Recent answer' },
      ];

      // Limit to 5 total messages (1 system + 4 latest)
      const res = trimConversationHistory(messages, { maxTotalMessages: 5 });
      expect(res.wasTrimmed).toBe(true);
      expect(res.messages.length).toBe(5);
      expect(res.messages[0].role).toBe('system');
      expect(res.messages[0].content).toBe('You are the Fleet360 Ops Assistant.');
      expect(res.messages[1].content).toBe('Turn 2: Mid question');
      expect(res.messages[4].content).toBe('Turn 3: Recent answer');
      expect(res.tokensSaved).toBeGreaterThan(0);
    });

    it('preserves complete assistant tool_calls and tool response blocks without breaking calling pairs', () => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'System Prompt' },
        { role: 'user', content: 'Old user msg' },
        { role: 'assistant', content: 'Old assistant msg' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'showFleetStatus', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'tc1', content: '{"available": 25}' },
        { role: 'user', content: 'Latest user query' },
      ];

      // Setting maxTotalMessages: 4 will include system prompt + (tool call + tool result + latest user)
      const res = trimConversationHistory(messages, { maxTotalMessages: 4 });
      expect(res.messages[0].role).toBe('system');
      const toolCallIdx = res.messages.findIndex(m => m.role === 'assistant' && 'tool_calls' in m);
      const toolRespIdx = res.messages.findIndex(m => m.role === 'tool');

      expect(toolCallIdx).toBeGreaterThan(0);
      expect(toolRespIdx).toBe(toolCallIdx + 1);
      expect((res.messages[toolRespIdx] as any).tool_call_id).toBe('tc1');
    });
  });

  describe('TenantSessionStore Isolation & Capacity Management', () => {
    it('strictly isolates threads across different tenants', () => {
      const store = new TenantSessionStore();

      store.addMessage('tenant-alpha', 'thread-1', { role: 'user', content: 'Alpha message' });
      store.addMessage('tenant-beta', 'thread-1', { role: 'user', content: 'Beta message' });

      const alphaMessages = store.getMessages('tenant-alpha', 'thread-1');
      const betaMessages = store.getMessages('tenant-beta', 'thread-1');

      expect(alphaMessages.length).toBe(1);
      expect(alphaMessages[0].content).toBe('Alpha message');

      expect(betaMessages.length).toBe(1);
      expect(betaMessages[0].content).toBe('Beta message');
    });

    it('evicts stale sessions based on TTL window', () => {
      // 10ms TTL store
      const store = new TenantSessionStore(10, 100);

      store.addMessage('tenant-1', 'thread-old', { role: 'user', content: 'Old message' });
      expect(store.sessionCount).toBe(1);

      // Artificially age session
      const entry = (store as any).sessions.get('tenant-1:thread-old');
      entry.lastAccessed = Date.now() - 50;

      const evicted = store.evictStaleSessions();
      expect(evicted).toBe(1);
      expect(store.sessionCount).toBe(0);
    });

    it('integrates with getMessageStore() backward-compatible helper', () => {
      const storeHelper = getMessageStore('test-thread-42', 'tenant-dxb');
      storeHelper.addMessage({ role: 'user', content: 'Hello Fleet360' });

      expect(storeHelper.messageList.length).toBe(1);
      const openAiList = storeHelper.getOpenAICompatibleMessageList({ maxTotalMessages: 10 });
      expect(openAiList.length).toBe(1);
      expect(openAiList[0].content).toBe('Hello Fleet360');
    });
  });
});
