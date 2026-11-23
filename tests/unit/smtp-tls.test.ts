/**
 * tests/unit/smtp-tls.test.ts
 *
 * Every SMTP transport verifies the mail server's certificate with TLS 1.2+
 * unless SMTP_ALLOW_INSECURE_TLS=true, and obsolete SSLv3 ciphers are never
 * requested (src/lib/smtp-tls.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { smtpTlsOptions } from '@/lib/smtp-tls';

afterEach(() => { vi.unstubAllEnvs(); });

describe('smtpTlsOptions', () => {
  it('verifies the certificate with TLS 1.2+ and requireTLS for STARTTLS/Office 365 without SSLv3', () => {
    expect(smtpTlsOptions('smtp.example.com', 'tls')).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(smtpTlsOptions('smtp.example.com', 'TLS')).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(smtpTlsOptions('smtp.example.com', 'STARTTLS')).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(smtpTlsOptions('smtp.example.com', 'ssl')).toEqual({
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(smtpTlsOptions('smtp.example.com', 'SSL')).toEqual({
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });

    const o365 = smtpTlsOptions('SMTP.OFFICE365.COM', 'tls');
    expect(o365).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(JSON.stringify(o365)).not.toContain('SSLv3');
  });

  it('adds nothing for an unencrypted server', () => {
    expect(smtpTlsOptions('smtp.example.com', 'none')).toEqual({});
    expect(smtpTlsOptions('smtp.example.com', 'NONE')).toEqual({});
  });

  it('allows an unverified certificate only when explicitly enabled', () => {
    vi.stubEnv('SMTP_ALLOW_INSECURE_TLS', 'true');
    expect(smtpTlsOptions('smtp.example.com', 'tls')).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false },
    });
    expect(smtpTlsOptions('smtp.office365.com', 'tls')).toEqual({
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false },
    });
  });

  it('unifies all legacy mailers onto smtpTlsOptions with zero hardcoded rejectUnauthorized: false or SSLv3 in src/', () => {
    const mailFiles = [
      'src/lib/smtp-tls.ts',
      'src/lib/email.ts',
      'src/lib/notifications.ts',
      'src/app/api/notifications/send/route.ts',
      'src/services/email/emailService.ts',
      'src/app/api/admin/test-channel/route.ts',
    ];
    for (const rel of mailFiles) {
      const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(source, `${rel} must not hardcode rejectUnauthorized: false`).not.toMatch(/rejectUnauthorized\s*:\s*false/);
      expect(source, `${rel} must not use obsolete SSLv3 cipher`).not.toMatch(/['"]SSLv3['"]/);
      if (rel !== 'src/lib/smtp-tls.ts') {
        expect(source, `${rel} must route TLS through smtpTlsOptions`).toContain('smtpTlsOptions');
      }
    }
  });
});
