/**
 * Shipper Portal — invitation token lifecycle.
 *
 *   1. Operator invites a portal user
 *        → createInvitation() generates random token, stores SHA-256 hash
 *        → sendInvitationEmail() emails the raw token in a setup link
 *   2. Shipper clicks link → /shipper-portal/setup?token=<raw>
 *   3. setup page calls acceptInvitation(rawToken, newPassword)
 *        → validates hash, checks expiry, sets password, marks accepted
 *
 * The raw token is NEVER stored — only its sha256 hash. A DB leak can't
 * be used to forge a setup link.
 */

import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { setPortalUserPassword } from './portal-users-store';
import { sendEmail } from '@/lib/email';
import { renderEmail, tenantEmailContext } from '@/lib/email-templates';

const INVITATION_TTL_DAYS = 7;

// ── Token helpers ──────────────────────────────────────────────────────

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Create ─────────────────────────────────────────────────────────────

export interface CreatedInvitation {
  id: string;
  /** The raw token — pass to the user in the setup URL. NEVER store this. */
  rawToken: string;
  expiresAt: string;
}

export async function createInvitation(args: {
  tenantId: string;
  portalUserId: string;
  invitedByUserId: string;
}): Promise<CreatedInvitation> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; expires_at: string }>>(
    `INSERT INTO customer_portal_invitations
       (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
     VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)
     RETURNING id::text, expires_at::text`,
    args.tenantId, args.portalUserId, tokenHash, expiresAt, args.invitedByUserId,
  );
  if (!rows[0]) throw new Error('createInvitation returned no row');
  return { id: rows[0].id, rawToken, expiresAt: rows[0].expires_at };
}

// ── Validate ───────────────────────────────────────────────────────────

interface InvitationRow {
  id: string;
  tenant_id: string;
  portal_user_id: string;
  expires_at: string;
  accepted_at: string | null;
}

export async function resolveInvitation(rawToken: string): Promise<InvitationRow | null> {
  const tokenHash = hashToken(rawToken);
  const rows = await prisma.$queryRawUnsafe<InvitationRow[]>(
    `SELECT id::text, tenant_id, portal_user_id::text, expires_at::text, accepted_at::text
       FROM customer_portal_invitations
      WHERE token_hash = $1
      LIMIT 1`,
    tokenHash,
  );
  const row = rows[0];
  if (!row) return null;
  if (row.accepted_at) return null;             // already used
  if (new Date(row.expires_at) < new Date()) return null; // expired
  return row;
}

// ── Accept ─────────────────────────────────────────────────────────────

/**
 * Single-use redemption. Sets the user's password and marks the
 * invitation accepted in one statement so concurrent redemptions can't
 * both succeed (PK-locked update).
 *
 * Returns the portalUserId on success, null on validation failure
 * (already used, expired, or unknown token).
 */
export async function acceptInvitation(
  rawToken: string,
  passwordHash: string,
): Promise<{ portalUserId: string; tenantId: string } | null> {
  const tokenHash = hashToken(rawToken);

  // Mark accepted only if still pending and not expired — atomic check.
  const claimRows = await prisma.$queryRawUnsafe<Array<{ portal_user_id: string; tenant_id: string }>>(
    `UPDATE customer_portal_invitations
        SET accepted_at = NOW()
      WHERE token_hash = $1
        AND accepted_at IS NULL
        AND expires_at > NOW()
      RETURNING portal_user_id::text, tenant_id`,
    tokenHash,
  );
  const claimed = claimRows[0];
  if (!claimed) return null;

  await setPortalUserPassword(claimed.portal_user_id, passwordHash);
  return { portalUserId: claimed.portal_user_id, tenantId: claimed.tenant_id };
}

// ── Email send ─────────────────────────────────────────────────────────

/**
 * Sends the setup link via the platform email sender (src/lib/email.ts),
 * worded by the tenant's "Shipper portal invitation" email template
 * (Admin > Email templates, English or Arabic).
 *
 * Non-fatal: returns { ok: false, reason } on SMTP misconfiguration so
 * the caller can show a "couldn't send email — copy the link manually"
 * UI without rolling back the invitation row.
 */
export async function sendInvitationEmail(args: {
  tenantId: string;
  recipientEmail: string;
  recipientName: string | null;
  customerName: string;
  rawToken: string;
  baseUrl: string;
  expiresAt: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const link = `${args.baseUrl.replace(/\/$/, '')}/shipper-portal/setup?token=${encodeURIComponent(args.rawToken)}`;
  const context = await tenantEmailContext(args.tenantId);
  const email = await renderEmail({
    tenantId: args.tenantId, key: 'shipper.portal_invitation', context,
    values: {
      recipientName: args.recipientName ?? '',
      customerName: args.customerName,
      setupUrl: link,
      expiresOn: new Date(args.expiresAt).toLocaleDateString(context.locale === 'ar' ? 'ar-AE' : 'en-AE', { day: 'numeric', month: 'long', year: 'numeric' }),
    },
  });

  // The platform email sender (SMTP under Admin > Settings > Notifications,
  // or SendGrid). An "IntegrationConfig" lookup used to come first here; it
  // read columns that table does not have, so it always failed.
  const r = await sendEmail({ to: args.recipientEmail, subject: email.subject, html: email.html, text: email.text });
  if (r.sent) return { ok: true };
  return {
    ok: false,
    reason: r.reason === 'not_configured' || r.reason === 'smtp_not_configured'
      ? 'No email transport configured — set up SMTP in Admin > Settings > Notifications, or set SENDGRID_API_KEY + EMAIL_FROM in the environment.'
      : (r.error ?? r.reason ?? 'Email send failed.'),
  };
}
