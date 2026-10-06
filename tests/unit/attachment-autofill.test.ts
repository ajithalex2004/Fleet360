/**
 * tests/unit/attachment-autofill.test.ts
 *
 * Reading Document Number / Expiry Date from tenant attachments, and the
 * Document Intelligence fix: a scan has to reach the model as the document.
 * Before, router.ts sent only "Analyze document scan: <file name>" to a
 * text model, so scans were "extracted" from the file name and still
 * reported HIGH confidence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { aiGateway } from '@/lib/agents/gateway';
import { processDocumentWithRouter } from '@/lib/agents/document-intelligence/pipeline/router';
import { autofillAttachment, autofillPrompt, normalizeDate, parseAutofillReply } from '@/lib/tenant-attachments-autofill';

const TRADE = { code: 'TRADE_LICENSE', name: 'Trade License', requiresExpiry: true };
const VAT = { code: 'VAT_CERTIFICATE', name: 'VAT Certificate', requiresExpiry: false };
const TODAY = '2026-10-06';

const gatewayReply = (content: string, fromFallback = false) => ({
  content, fromFallback, capabilityAlias: 'VISION_HIGH_ACCURACY', model: 'm', provider: 'openai',
  inputTokens: 1, outputTokens: 1, cachedTokens: 0, isCacheHit: false, costUsd: 0, costAed: 0,
  costAvoidedUsd: 0, costAvoidedAed: 0, telemetry: {},
}) as unknown as Awaited<ReturnType<typeof aiGateway.vision>>;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('parseAutofillReply', () => {
  it('returns the number and date read from the document', () => {
    expect(parseAutofillReply('{"documentNumber":" CN-1234567 ","expiryDate":"2027-12-31","confidence":0.93,"matchesExpectedType":true}', TRADE, TODAY))
      .toEqual({ status: 'ok', documentNumber: 'CN-1234567', expiryDate: '2027-12-31', confidence: 0.93, warnings: [] });
  });

  it('reads JSON wrapped in a markdown fence', () => {
    const r = parseAutofillReply('```json\n{"documentNumber":"1","expiryDate":null,"confidence":0.9,"matchesExpectedType":true}\n```', VAT, TODAY);
    expect(r.status).toBe('ok');
  });

  it('warns about an expired document, a missing required expiry and the wrong kind of document', () => {
    const expired = parseAutofillReply('{"documentNumber":"A","expiryDate":"2025-01-31","confidence":0.9,"matchesExpectedType":true}', TRADE, TODAY);
    expect(expired.status === 'ok' && expired.warnings).toEqual(['This document appears to have expired on 2025-01-31.']);

    const noExpiry = parseAutofillReply('{"documentNumber":"A","expiryDate":null,"confidence":0.9,"matchesExpectedType":true}', TRADE, TODAY);
    expect(noExpiry.status === 'ok' && noExpiry.warnings).toEqual(['No expiry date was found: enter it manually.']);

    const wrong = parseAutofillReply('{"documentNumber":"100","expiryDate":null,"confidence":0.9,"documentKind":"VAT certificate","matchesExpectedType":false}', TRADE, TODAY);
    expect(wrong.status === 'ok' && wrong.warnings[0]).toBe('This may not be a Trade License (it looks like: VAT certificate). Check that the right file was chosen.');
  });

  it('offers nothing when the model is unsure, and nothing invented from a malformed reply', () => {
    const unsure = parseAutofillReply('{"documentNumber":"X","expiryDate":"2027-01-01","confidence":0.3,"matchesExpectedType":true}', TRADE, TODAY);
    expect(unsure).toMatchObject({ status: 'ok', documentNumber: null, expiryDate: null });
    expect(parseAutofillReply('I could not read it', TRADE, TODAY)).toEqual({ status: 'unavailable', reason: 'The document could not be read.' });
  });

  it('keeps only real dates and normalises a 15-digit TRN', () => {
    expect(normalizeDate('2027-02-30')).toBeNull();
    expect(normalizeDate('31/12/2027')).toBeNull();
    expect(normalizeDate('2028-02-29')).toBe('2028-02-29');
    const trn = parseAutofillReply('{"documentNumber":"100-2345-6789-0003","expiryDate":null,"confidence":0.9,"matchesExpectedType":true}', VAT, TODAY);
    expect(trn.status === 'ok' && trn.documentNumber).toBe('100234567890003');
    const shortTrn = parseAutofillReply('{"documentNumber":"12345","expiryDate":null,"confidence":0.9,"matchesExpectedType":true}', VAT, TODAY);
    expect(shortTrn.status === 'ok' && shortTrn.warnings).toEqual(['A TRN has 15 digits: check the number that was read.']);
  });

  it('asks for the right number per type', () => {
    expect(autofillPrompt(VAT)).toContain('Tax Registration Number (TRN)');
    expect(autofillPrompt(TRADE)).toContain('trade license number');
    expect(autofillPrompt({ code: 'INSURANCE', name: 'Insurance', requiresExpiry: true })).toContain('main reference / document number');
  });
});

describe('autofillAttachment', () => {
  it('sends a PDF to the vision call as a PDF data URL', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    const vision = vi.spyOn(aiGateway, 'vision').mockResolvedValue(
      gatewayReply('{"documentNumber":"CN-9","expiryDate":"2027-06-30","confidence":0.9,"matchesExpectedType":true}'));
    const r = await autofillAttachment({ base64: 'JVBERi0=', mimeType: 'application/pdf', fileName: 'tl.pdf' }, TRADE, TODAY);
    expect(r).toMatchObject({ status: 'ok', documentNumber: 'CN-9', expiryDate: '2027-06-30' });
    expect(vision.mock.calls[0][0]).toEqual(['data:application/pdf;base64,JVBERi0=']);
  });

  it('is unavailable without a key or when the provider fails, never throwing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await autofillAttachment({ base64: 'x', mimeType: 'image/png', fileName: 'a.png' }, TRADE)).status).toBe('unavailable');
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.spyOn(aiGateway, 'vision').mockRejectedValue(new Error('timeout'));
    expect((await autofillAttachment({ base64: 'x', mimeType: 'image/png', fileName: 'a.png' }, TRADE)).status).toBe('unavailable');
  });
});

describe('aiGateway.vision', () => {
  it('sends PDFs as file parts and images as image parts, with the system prompt', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{}' } }], model: 'gpt-4o', usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await aiGateway.vision(['data:application/pdf;base64,JVBERi0=', 'data:image/png;base64,iVBOR'], 'read it', { systemPrompt: 'sys' });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1].content.map((p: { type: string }) => p.type)).toEqual(['text', 'file', 'image_url']);
    expect(body.messages[1].content[1].file.file_data).toBe('data:application/pdf;base64,JVBERi0=');
  });

  it('refuses to answer without a vision provider instead of asking a text-only model', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(aiGateway.vision(['data:image/png;base64,x'], 'read it')).rejects.toThrow('Vision is unavailable');
  });
});

describe('Document Intelligence router', () => {
  beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'k'); });

  it('sends a scan to the vision model as the document, not its file name', async () => {
    const vision = vi.spyOn(aiGateway, 'vision').mockResolvedValue(gatewayReply(
      '{"docCategory":"INSURANCE_POLICY","suggestedTitle":"Policy","confidenceScore":0.7,"referenceNumber":"P-1","expiryDate":"2027-03-01"}'));
    const chat = vi.spyOn(aiGateway, 'chat');
    const r = await processDocumentWithRouter({ fileName: 'scan.jpg', imageBase64: '/9j/4AAQ', mimeType: 'image/jpeg' });
    expect(chat).not.toHaveBeenCalled();
    expect(vision.mock.calls[0][0]).toEqual(['data:image/jpeg;base64,/9j/4AAQ']);
    expect(r).toMatchObject({ referenceNumber: 'P-1', expiryDate: '2027-03-01', confidence: 'MEDIUM', confidenceScore: 0.7 });
  });

  it('falls back to the offline parser, without an invented issue date, when no AI answers', async () => {
    vi.spyOn(aiGateway, 'vision').mockRejectedValue(new Error('Vision is unavailable'));
    const r = await processDocumentWithRouter({ fileName: 'scan.jpg', imageBase64: '/9j/4AAQ', mimeType: 'image/jpeg' });
    expect(r.issueDate).toBeUndefined();
  });
});
