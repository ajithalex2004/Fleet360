/**
 * tests/unit/smtp-tls.test.ts
 *
 * The platform SMTP transport verifies the mail server's certificate unless
 * SMTP_ALLOW_INSECURE_TLS=true (src/lib/smtp-tls.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { smtpTlsOptions } from '@/lib/smtp-tls';

afterEach(() => { vi.unstubAllEnvs(); });

describe('smtpTlsOptions', () => {
  it('verifies the certificate for STARTTLS, SSL and Office 365', () => {
    expect(smtpTlsOptions('smtp.example.com', 'tls')).toEqual({ tls: { rejectUnauthorized: true } });
    expect(smtpTlsOptions('smtp.example.com', 'ssl')).toEqual({ tls: { rejectUnauthorized: true } });
    expect(smtpTlsOptions('smtp.office365.com', 'tls'))
      .toEqual({ requireTLS: true, tls: { ciphers: 'SSLv3', rejectUnauthorized: true } });
  });

  it('adds nothing for an unencrypted server', () => {
    expect(smtpTlsOptions('smtp.example.com', 'none')).toEqual({});
  });

  it('allows an unverified certificate only when explicitly enabled', () => {
    vi.stubEnv('SMTP_ALLOW_INSECURE_TLS', 'true');
    expect(smtpTlsOptions('smtp.example.com', 'tls')).toEqual({ tls: { rejectUnauthorized: false } });
  });
});
