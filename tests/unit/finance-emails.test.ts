/**
 * tests/unit/finance-emails.test.ts
 *
 * - The platform email sender (src/lib/email.ts) classifies a failed SMTP
 *   send: DEFINITE_FAILURE before the message could be accepted (CONN,
 *   AUTH, MAIL, RCPT), UNCERTAIN otherwise. Dunning relies on this to never
 *   send a notice twice. isEmailTransportConfigured honours the kill switch.
 * - Platform subscription emails go through the platform-only templates,
 *   to the tenant's billing email.
 * - The dunning invoice table escapes values and follows the language.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  sendMail: vi.fn(),
  templated: [] as Array<Record<string, unknown>>,
  smtpRows: [] as Array<{ key: string; value: string }>,
}));

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: state.sendMail }) } }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('platform_settings')) return state.smtpRows;
      if (sql.includes('stripe_customer_id')) return [{ id: 't1' }];
      return [];
    },
  },
}));
vi.mock('@/lib/billing', () => ({
  getTenantBilling: async () => ({ tenantId: 't1', tenantName: 'Acme Fleet', billingEmail: 'billing@acme.test' }),
}));
vi.mock('@/lib/email-templates', () => ({
  appUrl: (p: string) => `https://app.test${p}`,
  sendTemplatedEmail: async (args: Record<string, unknown>) => { state.templated.push(args); return { sent: true }; },
}));

import { sendEmail, isEmailTransportConfigured, invalidateSmtpCache } from '@/lib/email';
import { emailPaymentFailed, emailTrialEnding, emailSubscriptionCanceled } from '@/lib/billing-emails';
import { dunningInvoiceBlock, dunningValues } from '@/lib/finance/dunning-templates';

const SMTP = [
  { key: 'smtp_host', value: 'smtp.acme.test' }, { key: 'smtp_username', value: 'u' }, { key: 'smtp_password', value: 'p' },
];

beforeEach(() => {
  state.sendMail.mockReset(); state.templated = []; state.smtpRows = SMTP;
  invalidateSmtpCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('platform email sender failure classes', () => {
  it('a failure at RCPT is definite; one during DATA is uncertain', async () => {
    state.sendMail.mockRejectedValueOnce(Object.assign(new Error('rejected'), { command: 'RCPT' }));
    expect(await sendEmail({ to: 'a@b.test', subject: 's', text: 't' })).toMatchObject({ sent: false, errorClass: 'DEFINITE_FAILURE' });
    state.sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { command: 'DATA' }));
    expect(await sendEmail({ to: 'a@b.test', subject: 's', text: 't' })).toMatchObject({ sent: false, errorClass: 'UNCERTAIN' });
    state.sendMail.mockResolvedValueOnce({ messageId: '<m1>' });
    expect(await sendEmail({ to: 'a@b.test', subject: 's', text: 't' })).toMatchObject({ sent: true, id: '<m1>' });
  });

  it('reports a transport only when one is configured and outbound mail is not disabled', async () => {
    expect(await isEmailTransportConfigured()).toBe(true);
    vi.stubEnv('DISABLE_OUTBOUND_NOTIFICATIONS', 'true');
    expect(await isEmailTransportConfigured()).toBe(false);
    vi.unstubAllEnvs();
    state.smtpRows = []; invalidateSmtpCache();
    expect(await isEmailTransportConfigured()).toBe(false);
  });
});

describe('platform subscription emails', () => {
  it('use the platform-only templates, to the tenant billing email', async () => {
    await emailPaymentFailed({ customer: 'cus_1', amount_due: 49900, currency: 'usd', hosted_invoice_url: 'https://inv.test/1' } as never);
    await emailTrialEnding({ customer: 'cus_1', trial_end: Date.UTC(2026, 9, 14) / 1000 } as never);
    await emailSubscriptionCanceled({ customer: 'cus_1' } as never);
    expect(state.templated.map((t) => [t.key, t.tenantId, t.to])).toEqual([
      ['platform.billing_payment_failed', 't1', 'billing@acme.test'],
      ['platform.billing_trial_ending', 't1', 'billing@acme.test'],
      ['platform.billing_subscription_canceled', 't1', 'billing@acme.test'],
    ]);
    expect(state.templated[0].values).toMatchObject({ tenantName: 'Acme Fleet', amount: '499.00 USD', invoiceUrl: 'https://inv.test/1' });
    const trial = state.templated[1].values as (l: string) => Record<string, string>;
    expect(trial('en').trialEndDate).toBe('14 October 2026');
  });
});

describe('dunning invoice table', () => {
  const invoice = { invoiceNo: 'INV-<1>', dueDate: new Date('2026-08-01'), daysOverdue: 32, outstandingAmount: 18500, currency: 'AED' };
  it('escapes values and follows the language', () => {
    const en = dunningInvoiceBlock(invoice, 'en');
    expect(en.html).toContain('INV-&lt;1&gt;');
    expect(en.html).toContain('AED 18,500.00');
    expect(dunningInvoiceBlock(invoice, 'ar').html).toContain('الأيام المتأخرة');
    expect(dunningValues(invoice, 'Co', 'ar').productName).toBe('إيجار المركبة');
    expect(en.text).toContain('Days overdue: 32 days');
  });
});
