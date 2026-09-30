/**
 * TLS options for the platform SMTP transport (src/lib/email.ts) and its
 * "send test email" check (/api/admin/test-channel), so a successful test
 * means real mail will go out the same way.
 *
 * The server certificate is verified. Both used to set
 * rejectUnauthorized: false, so anyone on the network path could pose as the
 * mail server and read or alter approval requests, quotations and portal
 * invitations. A server with a self-signed certificate can still be used by
 * setting SMTP_ALLOW_INSECURE_TLS=true in the environment.
 */
export function smtpTlsOptions(host: string, encryption: string): {
  requireTLS?: boolean;
  tls?: { ciphers?: string; rejectUnauthorized: boolean };
} {
  const rejectUnauthorized = process.env.SMTP_ALLOW_INSECURE_TLS !== 'true';
  // Office 365 / Exchange require explicit TLS options.
  if (host.includes('office365') || host.includes('outlook.com') || host.includes('exchange')) {
    return { requireTLS: true, tls: { ciphers: 'SSLv3', rejectUnauthorized } };
  }
  if (encryption === 'tls' || encryption === 'ssl') return { tls: { rejectUnauthorized } };
  return {};
}
