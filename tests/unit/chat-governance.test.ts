import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordRun = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/agents/orchestrator', () => ({
  recordRun: (...args: unknown[]) => recordRun(...args),
  checkRunAllowed: vi.fn(),
}));

import { chatUsage, recordChatTurn } from '@/lib/agents/chat-governance';

describe('chatUsage', () => {
  it('uses the usage the provider reported on the stream', () => {
    expect(chatUsage({ prompt_tokens: 1200, completion_tokens: 300 }, [{ role: 'user', content: 'hi' }], 'reply'))
      .toEqual({ inputTokens: 1200, outputTokens: 300, estimated: false });
  });

  it('estimates ~4 characters per token when the stream reported none', () => {
    const prompt = [{ role: 'user', content: 'x'.repeat(390) }]; // JSON is ~420 chars
    const usage = chatUsage(null, prompt, 'y'.repeat(400));

    expect(usage.estimated).toBe(true);
    expect(usage.outputTokens).toBe(100);
    expect(usage.inputTokens).toBe(Math.ceil(JSON.stringify(prompt).length / 4));
  });
});

describe('recordChatTurn', () => {
  beforeEach(() => {
    recordRun.mockClear();
  });

  it('records the turn for the caller tenant with its tokens, marking estimates', () => {
    recordChatTurn({
      tenantId: 't1',
      agentId: 'ops-assistant',
      eventType: 'ops.query_received',
      threadId: 'th-1',
      messageCount: 4,
      toolsUsed: ['getFleetStatus'],
      durationMs: 900,
      usage: { inputTokens: 800, outputTokens: 120, estimated: true },
    });

    const [event, result] = recordRun.mock.calls[0];
    expect(event).toMatchObject({ tenant_id: 't1', agent_id: 'ops-assistant' });
    expect(result.telemetry).toMatchObject({ inputTokens: 800, outputTokens: 120, modelProvider: 'thesys' });
    expect(result.output).toMatchObject({ toolsUsed: ['getFleetStatus'], tokenUsage: 'estimated' });
  });
});
