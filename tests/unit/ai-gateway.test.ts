import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aiGateway, AIGatewayService, GatewayMessage } from '../../src/lib/agents/gateway';
import { chatComplete, complete } from '../../src/lib/agents/openai-client';

describe('Phase 4: Shared Fleet360 AI Gateway & Capability Aliases', () => {
  beforeEach(() => {
    aiGateway.clearCache();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('1. Canned Offline Deterministic Fallback', () => {
    it('returns deterministic offline response when no external API keys are configured', async () => {
      const messages: GatewayMessage[] = [
        { role: 'user', content: 'What is the standard UAE lease penalty?' },
      ];

      const res = await aiGateway.chat(messages, {
        capabilityAlias: 'ECONOMY_TEXT',
        fallbackText: 'Standard penalty is 10% of remaining lease value.',
      });

      expect(res.fromFallback).toBe(true);
      expect(res.isCacheHit).toBe(false);
      expect(res.provider).toBe('deterministic');
      expect(res.content).toBe('Standard penalty is 10% of remaining lease value.');
      expect(res.costUsd).toBe(0);
      expect(res.costAed).toBe(0);
      expect(res.telemetry.modelAlias).toBe('DETERMINISTIC_RULES');
    });

    it('handles complete() shorthand with fallback', async () => {
      const text = await complete('You are a helpful assistant.', 'Summarize fuel logs.', {
        fallback: 'Fuel consumption normal.',
      });

      expect(text).toBe('Fuel consumption normal.');
    });
  });

  describe('2. Response Caching & Avoided Cost Attribution', () => {
    it('caches successful responses in L1 memory and attributes avoided cost on repeat queries', async () => {
      const gateway = new AIGatewayService();
      
      // Mock OpenAI call
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Contract is active until Dec 2026.' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 500, completion_tokens: 50 },
        }),
      });

      process.env.OPENAI_API_KEY = 'mock-openai-key';

      try {
        const messages: GatewayMessage[] = [
          { role: 'user', content: 'Contract expiration date query for C-1049' },
        ];

        // First call -> Cache Miss (Queries Provider)
        const first = await gateway.chat(messages, {
          capabilityAlias: 'ECONOMY_TEXT',
          tenantId: 'tenant-uae',
        });

        expect(first.isCacheHit).toBe(false);
        expect(first.content).toBe('Contract is active until Dec 2026.');
        expect(first.inputTokens).toBe(500);
        expect(first.outputTokens).toBe(50);
        expect(first.costUsd).toBeGreaterThan(0);
        expect(first.costAed).toBeGreaterThan(0);

        // Second call -> Cache Hit (Avoids Provider)
        const second = await gateway.chat(messages, {
          capabilityAlias: 'ECONOMY_TEXT',
          tenantId: 'tenant-uae',
        });

        expect(second.isCacheHit).toBe(true);
        expect(second.content).toBe('Contract is active until Dec 2026.');
        expect(second.costUsd).toBe(0); // Free cache hit
        expect(second.costAed).toBe(0);
        expect(second.costAvoidedUsd).toBeGreaterThan(0); // Tracked savings
        expect(second.costAvoidedAed).toBeGreaterThan(0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('3. Multi-Provider Fallback Stack (OpenAI -> Gemini -> Anthropic)', () => {
    it('automatically falls back to Gemini when OpenAI returns an HTTP error', async () => {
      const gateway = new AIGatewayService();
      process.env.OPENAI_API_KEY = 'failing-openai-key';
      process.env.GEMINI_API_KEY = 'working-gemini-key';

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('openai.com')) {
          return {
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
          };
        }
        if (url.includes('googleapis.com')) {
          return {
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: 'Gemini fallback analysis complete.' }] } }],
              usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 },
            }),
          };
        }
        return { ok: false, status: 500 };
      });

      try {
        const res = await gateway.chat([{ role: 'user', content: 'Explain dispatch delay' }], {
          capabilityAlias: 'ECONOMY_TEXT',
        });

        expect(res.provider).toBe('gemini');
        expect(res.content).toBe('Gemini fallback analysis complete.');
        expect(res.fromFallback).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('4. Structured JSON Output Extraction', () => {
    it('extracts strongly-typed JSON data from structured prompts', async () => {
      const gateway = new AIGatewayService();
      process.env.OPENAI_API_KEY = 'mock-key';

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"status": "VALID", "vatRate": 0.05, "confidence": 0.98}' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 150, completion_tokens: 20 },
        }),
      });

      try {
        interface VatResult {
          status: string;
          vatRate: number;
          confidence: number;
        }

        const res = await gateway.structuredOutput<VatResult>(
          [{ role: 'user', content: 'Check VAT rate for invoice INV-1002' }],
          '{ status: string, vatRate: number, confidence: number }',
        );

        expect(res.data).not.toBeNull();
        expect(res.data?.status).toBe('VALID');
        expect(res.data?.vatRate).toBe(0.05);
        expect(res.data?.confidence).toBe(0.98);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('5. Legacy Client Adapter Backward Compatibility', () => {
    it('maintains 100% backward compatibility for chatComplete()', async () => {
      const res = await chatComplete(
        [{ role: 'user', content: 'Legacy query' }],
        { fallback: 'Legacy fallback response' },
      );

      expect(res.content).toBe('Legacy fallback response');
      expect(res.fromFallback).toBe(true);
      expect(res.model).toBe('deterministic-fallback');
    });
  });
});
