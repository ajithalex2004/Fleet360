import { describe, it, expect } from 'vitest';
import {
  parseTier1Regex,
  parseInboundMessage,
  type InboundMessageParams,
} from '@/lib/service-tickets/whatsapp-nlp-engine';

describe('WhatsApp Omnichannel NLP Ingestion Engine (Hybrid 2-Tier)', () => {
  describe('Tier 1: Fast Deterministic Regex & Keyword Parser', () => {
    it('extracts UAE plate number and classifies Emergency Towing', () => {
      const message =
        'My bus broke down on Sheikh Zayed Road near Exit 36, plate Dubai B 45210, need immediate recovery truck';

      const result = parseTier1Regex(message);

      expect(result).not.toBeNull();
      expect(result?.ticketType).toBe('TOWING');
      expect(result?.priority).toBe('High');
      expect(result?.extractedPlateNumber).toBe('Dubai B 45210');
      expect(result?.tierUsed).toBe('TIER_1_REGEX');
      expect(result?.category).toBe('BREAKDOWN_RECOVERY');
      expect(result?.suggestedAutoReply).toContain('Dubai B 45210');
    });

    it('extracts tyre puncture and classifies as High Priority Maintenance', () => {
      const message =
        'Bus has flat tyre / puncture near Jebel Ali Freezone. Plate: Abu Dhabi 5 99882';

      const result = parseTier1Regex(message);

      expect(result).not.toBeNull();
      expect(result?.ticketType).toBe('MAINTENANCE');
      expect(result?.priority).toBe('High');
      expect(result?.extractedPlateNumber).toBe('Abu Dhabi 5 99882');
      expect(result?.category).toBe('PUNCTURE_OR_TYRE');
    });

    it('extracts AC failure and classifies as Medium Priority Maintenance', () => {
      const message = 'The AC not working and blowing hot air in Sharjah 4412';

      const result = parseTier1Regex(message);

      expect(result).not.toBeNull();
      expect(result?.ticketType).toBe('MAINTENANCE');
      expect(result?.priority).toBe('Medium');
      expect(result?.extractedPlateNumber).toBe('Sharjah 4412');
      expect(result?.category).toBe('AC_FAILURE');
    });

    it('handles Arabic emergency breakdown keywords', () => {
      const message = 'عندي بنشر في شارع الشيخ زايد للباص رقم Dubai A 12345';

      const result = parseTier1Regex(message);

      expect(result).not.toBeNull();
      expect(result?.ticketType).toBe('MAINTENANCE');
      expect(result?.priority).toBe('High');
      expect(result?.extractedPlateNumber).toBe('Dubai A 12345');
      expect(result?.category).toBe('PUNCTURE_OR_TYRE');
    });

    it('handles Urdu/Hindi roadside stoppage keywords', () => {
      const message = 'Gari band ho gayi hai Al Barsha mein, please send tow truck';

      const result = parseTier1Regex(message);

      expect(result).not.toBeNull();
      expect(result?.ticketType).toBe('TOWING');
      expect(result?.priority).toBe('High');
      expect(result?.category).toBe('BREAKDOWN_RECOVERY');
    });
  });

  describe('Hybrid Orchestrator & Graceful Fallbacks', () => {
    it('uses Tier 1 when high confidence regex matches', async () => {
      const params: InboundMessageParams = {
        from: 'whatsapp:+971501112233',
        body: 'Car accident collision on E311, need police report assistance plate Dubai C 99812',
      };

      const result = await parseInboundMessage(params);

      expect(result.ticketType).toBe('INCIDENT');
      expect(result.priority).toBe('High');
      expect(result.tierUsed).toBe('TIER_1_REGEX');
      expect(result.extractedPlateNumber).toBe('Dubai C 99812');
    });

    it('falls back safely to general support when no keywords or API key available', async () => {
      const params: InboundMessageParams = {
        from: 'whatsapp:+971509998877',
        body: 'Hello, could you please tell me what time the office opens tomorrow?',
      };

      const result = await parseInboundMessage(params);

      expect(result.ticketType).toBe('SUPPORT');
      expect(result.priority).toBe('Medium');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });
});
