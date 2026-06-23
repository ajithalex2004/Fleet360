import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { decideNotify, formatEtaSms, formatEtaEmail } from '@/lib/logistics/eta-notifier';
import { formatSmsTo, sendSms, _setFetchForTests, _resetFetchForTests } from '@/lib/sms';
import type { EtaPrediction } from '@/lib/logistics/eta-predictor';

function pred(over: Partial<EtaPrediction>): EtaPrediction {
  return {
    etaAt: '2026-06-22T10:00:00Z',
    method: 'observed-speed',
    confidence: 'high',
    remainingKm: 30,
    effectiveSpeedKmh: 50,
    reason: 'test',
    ...over,
  };
}

// ── decideNotify ─────────────────────────────────────────────────────────────

describe('decideNotify', () => {
  it('notifies on the first confident ETA (no prior)', () => {
    const d = decideNotify({ prediction: pred({}), lastNotifiedEtaAt: null });
    expect(d.notify).toBe(true);
    expect(d.reason).toMatch(/first ETA/i);
  });

  it('does not notify for a planned-fallback prediction', () => {
    const d = decideNotify({ prediction: pred({ method: 'planned' }), lastNotifiedEtaAt: null });
    expect(d.notify).toBe(false);
  });

  it('does not notify for an arrived prediction', () => {
    const d = decideNotify({ prediction: pred({ method: 'arrived' }), lastNotifiedEtaAt: null });
    expect(d.notify).toBe(false);
  });

  it('does not notify for a low-confidence prediction', () => {
    const d = decideNotify({ prediction: pred({ confidence: 'low' }), lastNotifiedEtaAt: null });
    expect(d.notify).toBe(false);
  });

  it('notifies when the ETA shifts beyond the threshold', () => {
    const d = decideNotify({
      prediction: pred({ etaAt: '2026-06-22T10:30:00Z' }),  // +30min vs last
      lastNotifiedEtaAt: '2026-06-22T10:00:00Z',
      thresholdMinutes: 15,
    });
    expect(d.notify).toBe(true);
    expect(d.deltaMinutes).toBe(30);
  });

  it('stays quiet for a sub-threshold shift', () => {
    const d = decideNotify({
      prediction: pred({ etaAt: '2026-06-22T10:08:00Z' }),  // +8min
      lastNotifiedEtaAt: '2026-06-22T10:00:00Z',
      thresholdMinutes: 15,
    });
    expect(d.notify).toBe(false);
    expect(d.deltaMinutes).toBe(8);
  });

  it('notifies on a large EARLIER shift too', () => {
    const d = decideNotify({
      prediction: pred({ etaAt: '2026-06-22T09:30:00Z' }),  // -30min
      lastNotifiedEtaAt: '2026-06-22T10:00:00Z',
      thresholdMinutes: 15,
    });
    expect(d.notify).toBe(true);
    expect(d.deltaMinutes).toBe(-30);
  });

  it('respects a custom threshold', () => {
    const base = { prediction: pred({ etaAt: '2026-06-22T10:20:00Z' }), lastNotifiedEtaAt: '2026-06-22T10:00:00Z' };
    expect(decideNotify({ ...base, thresholdMinutes: 30 }).notify).toBe(false); // 20 < 30
    expect(decideNotify({ ...base, thresholdMinutes: 10 }).notify).toBe(true);  // 20 ≥ 10
  });
});

// ── message formatting ───────────────────────────────────────────────────────

describe('ETA message formatting', () => {
  it('SMS mentions shipment, destination, and delay direction', () => {
    const msg = formatEtaSms({ shipmentNo: 'LOG-1', destination: 'Abu Dhabi', etaAt: '2026-06-22T10:00:00Z', deltaMinutes: 25 });
    expect(msg).toContain('LOG-1');
    expect(msg).toContain('Abu Dhabi');
    expect(msg).toMatch(/delayed/i);
    expect(msg).toContain('GST');
  });

  it('SMS marks an earlier arrival', () => {
    const msg = formatEtaSms({ shipmentNo: 'LOG-1', destination: null, etaAt: '2026-06-22T10:00:00Z', deltaMinutes: -20 });
    expect(msg).toMatch(/earlier/i);
  });

  it('email subject carries the shipment and a time', () => {
    const { subject, text, html } = formatEtaEmail({ shipmentNo: 'LOG-9', customerName: 'Acme', destination: 'Sharjah', etaAt: '2026-06-22T10:00:00Z', deltaMinutes: 18 });
    expect(subject).toContain('LOG-9');
    expect(text).toContain('Acme');
    expect(text).toMatch(/delayed by 18 min/);
    expect(html).toContain('<strong>LOG-9</strong>');
  });

  it('converts UTC to GST (UTC+4) in the displayed time', () => {
    // 10:00 UTC → 14:00 GST
    const msg = formatEtaSms({ shipmentNo: 'X', destination: null, etaAt: '2026-06-22T10:00:00Z', deltaMinutes: null });
    expect(msg).toContain('14:00 GST');
  });
});

// ── formatSmsTo ──────────────────────────────────────────────────────────────

describe('formatSmsTo', () => {
  it('keeps a +E.164 number', () => {
    expect(formatSmsTo('+971501234567')).toBe('+971501234567');
  });
  it('strips spaces, dashes, parens and adds +', () => {
    expect(formatSmsTo('971 50 (123) 45-67')).toBe('+971501234567');
  });
  it('rejects junk', () => {
    expect(formatSmsTo('not-a-phone')).toBeNull();
    expect(formatSmsTo('')).toBeNull();
    expect(formatSmsTo(null)).toBeNull();
    expect(formatSmsTo('123')).toBeNull(); // too short
  });
});

// ── sendSms ──────────────────────────────────────────────────────────────────

describe('sendSms', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_SMS_NUMBER = '+10000000000';
  });
  afterEach(() => { _resetFetchForTests(); });

  it('no-ops (not_configured) when env is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const r = await sendSms({ to: '+971501234567', body: 'hi' });
    expect(r).toEqual({ sent: false, reason: 'not_configured' });
  });

  it('returns no_phone for an unparseable number', async () => {
    const r = await sendSms({ to: 'garbage', body: 'hi' });
    expect(r.reason).toBe('no_phone');
  });

  it('posts to Twilio and returns the sid on success', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ sid: 'SM123' }),
    });
    _setFetchForTests(fetchSpy as unknown as typeof fetch);
    const r = await sendSms({ to: '+971501234567', body: 'hi' });
    expect(r.sent).toBe(true);
    expect(r.sid).toBe('SM123');
    // Posted form-encoded with To/From/Body
    const call = fetchSpy.mock.calls[0];
    expect(call[1].body).toContain('To=%2B971501234567');
    expect(call[1].body).toContain('Body=hi');
  });

  it('returns twilio_error on a non-2xx without throwing', async () => {
    _setFetchForTests(vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad') }) as unknown as typeof fetch);
    const r = await sendSms({ to: '+971501234567', body: 'hi' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('twilio_error');
  });

  it('returns network_error when fetch throws', async () => {
    _setFetchForTests(vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch);
    const r = await sendSms({ to: '+971501234567', body: 'hi' });
    expect(r.reason).toBe('network_error');
  });
});
