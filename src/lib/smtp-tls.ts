/**
 * Canonical TLS options for every Fleet360 SMTP transport (src/lib/email.ts,
 * src/lib/notifications.ts, src/services/email/emailService.ts,
 * /api/notifications/send, and /api/admin/test-channel), so a successful test
 * means real mail goes out with the exact same TLS policy.
 *
 * Server certificates are verified with TLS 1.2+ by default. Obsolete SSLv3
 * cipher pinning has been removed — modern Exchange Online / Microsoft 365 and
 * SMTP relays negotiate TLS 1.2+ directly. A server with a self-signed
 * certificate can only opt out via explicit SMTP_ALLOW_INSECURE_TLS=true.
 */
export function smtpTlsOptions(host: string, encryption: string): {
  requireTLS?: boolean;
  tls?: { minVersion: 'TLSv1.2'; rejectUnauthorized: boolean };
} {
  const normalizedHost = (host || '').trim().toLowerCase();
  const normalizedEncryption = (encryption || '').trim().toLowerCase();
  const rejectUnauthorized = process.env.SMTP_ALLOW_INSECURE_TLS !== 'true';

  // Office 365 / Exchange Online require explicit STARTTLS with TLS 1.2+.
  if (
    normalizedHost.includes('office365') ||
    normalizedHost.includes('outlook.com') ||
    normalizedHost.includes('exchange')
  ) {
    return { requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized } };
  }

  if (normalizedEncryption === 'tls' || normalizedEncryption === 'starttls') {
    return { requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized } };
  }

  if (normalizedEncryption === 'ssl') {
    return { tls: { minVersion: 'TLSv1.2', rejectUnauthorized } };
  }

  return {};
}
