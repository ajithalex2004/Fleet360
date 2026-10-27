/**
 * Leasing Portal — invitation token lifecycle.
 *
 * Mirrors src/lib/shipper-portal/invitations.ts.
 *
 *   1. Staff invites a lessee contact to the portal (from the Lessees page)
 *        → createInvitation() generates random token, stores SHA-256 hash
 *        → sendInvitationEmail() emails the raw token in a setup link
 *   2. Lessee clicks link → /leasing-portal/setup?token=<raw>
 *   3. setup page calls acceptInvitation(rawToken, newPassword)
 *        → validates hash, checks expiry, sets password, marks accepted
 *
 * The raw token is NEVER stored — only its sha256 hash. A DB leak can't be
 * used to forge a setup link.
 */

import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import crypto from 'crypto';
import { sendTemplatedEmail, tenantEmailContext } from '@/lib/email-templates';

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

  // Invitations are under RLS: written in the inviting tenant's scope.
  const rows = await withTenantRls(prisma, args.tenantId, (tx) => tx.$queryRawUnsafe<Array<{ id: string; expires_at: string }>>(
    `INSERT INTO lessee_portal_invitations
       (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
     VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)
     RETURNING id::text, expires_at::text`,
    args.tenantId, args.portalUserId, tokenHash, expiresAt, args.invitedByUserId,
  ));
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
  // The token is all the caller has: find it across tenants (RLS would
  // otherwise hide every row from a public, tenant-less request).
  const rows = await runOutsideRlsScope(() => withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<InvitationRow[]>(
    `SELECT id::text, tenant_id, portal_user_id::text, expires_at::text, accepted_at::text
       FROM lessee_portal_invitations
      WHERE token_hash = $1
      LIMIT 1`,
    tokenHash,
  )));
  const row = rows[0];
  if (!row) return null;
  if (row.accepted_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

// ── Accept ─────────────────────────────────────────────────────────────

/**
 * Single-use redemption. Sets the user's password and marks the
 * invitation accepted in one statement so concurrent redemptions can't
 * both succeed (atomic conditional UPDATE).
 */
export async function acceptInvitation(
  rawToken: string,
  passwordHash: string,
): Promise<{ portalUserId: string; tenantId: string } | null> {
  const tokenHash = hashToken(rawToken);

  // One transaction: the claim and the password land together, or neither
  // does (a failed password write used to leave the invitation spent). The
  // token is all the caller has, so this runs across tenants; the password
  // write is pinned to the tenant the invitation belongs to.
  return runOutsideRlsScope(() => withPlatformAdmin(prisma, async (tx) => {
    const claimRows = await tx.$queryRawUnsafe<Array<{ portal_user_id: string; tenant_id: string }>>(
        `UPDATE lessee_portal_invitations
            SET accepted_at = NOW()
          WHERE token_hash = $1
            AND accepted_at IS NULL
            AND expires_at > NOW()
          RETURNING portal_user_id::text, tenant_id`,
        tokenHash,
    );
    const claimed = claimRows[0];
    if (!claimed) return null;

    await tx.$executeRawUnsafe(
      `UPDATE lessee_portal_users
          SET password_hash = $1, updated_at = NOW()
        WHERE id = $2::uuid AND tenant_id = $3`,
      passwordHash, claimed.portal_user_id, claimed.tenant_id,
    );
    return { portalUserId: claimed.portal_user_id, tenantId: claimed.tenant_id };
  }));
}

// ── Email send ─────────────────────────────────────────────────────────

/**
 * Sends the setup link through the platform email sender (src/lib/email.ts),
 * worded by the tenant's "Leasing portal invitation" template (Admin > Email
 * templates, English or Arabic).
 */
export async function sendInvitationEmail(args: {
  tenantId: string;
  recipientEmail: string;
  recipientName: string | null;
  lesseeName: string;
  rawToken: string;
  baseUrl: string;
  expiresAt: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const link = `${args.baseUrl.replace(/\/$/, '')}/leasing-portal/setup?token=${encodeURIComponent(args.rawToken)}`;
  const context = await tenantEmailContext(args.tenantId);
  const r = await sendTemplatedEmail({
    tenantId: args.tenantId, key: 'leasing.portal_invitation', context, to: args.recipientEmail,
    values: {
      recipientName: args.recipientName ?? '',
      lesseeName: args.lesseeName,
      setupUrl: link,
      expiresOn: new Date(args.expiresAt).toLocaleDateString(context.locale === 'ar' ? 'ar-AE' : 'en-AE', { day: 'numeric', month: 'long', year: 'numeric' }),
    },
  });
  if (r.sent) return { ok: true };
  return {
    ok: false,
    reason: r.reason === 'not_configured' || r.reason === 'smtp_not_configured'
      ? 'No email transport configured — set up SMTP in Admin > Settings > Notifications, or set SENDGRID_API_KEY + EMAIL_FROM in the environment.'
      : (r.error ?? r.reason ?? 'Email send failed.'),
  };
}
