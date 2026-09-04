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
import crypto from 'crypto';
import { setPortalUserPassword } from './portal-users-store';
import { sendEmail } from '@/lib/email';

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
    `INSERT INTO lessee_portal_invitations
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
       FROM lessee_portal_invitations
      WHERE token_hash = $1
      LIMIT 1`,
    tokenHash,
  );
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

  const claimRows = await prisma.$queryRawUnsafe<Array<{ portal_user_id: string; tenant_id: string }>>(
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

  await setPortalUserPassword(claimed.portal_user_id, passwordHash);
  return { portalUserId: claimed.portal_user_id, tenantId: claimed.tenant_id };
}

// ── Email send ─────────────────────────────────────────────────────────

export async function sendInvitationEmail(args: {
  recipientEmail: string;
  recipientName: string | null;
  lesseeName: string;
  rawToken: string;
  baseUrl: string;
  expiresAt: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const link = `${args.baseUrl.replace(/\/$/, '')}/leasing-portal/setup?token=${encodeURIComponent(args.rawToken)}`;
  const greeting = args.recipientName ? `Dear ${args.recipientName},` : 'Hello,';
  const subject = `Set up your Fleet360 leasing portal access for ${args.lesseeName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
      <div style="background:linear-gradient(135deg,#0891b2,#0e7490);padding:24px;border-radius:10px;margin-bottom:24px;">
        <h1 style="color:white;margin:0;font-size:20px;">Fleet360 Leasing Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">${args.lesseeName}</p>
      </div>
      <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0;">
        <p style="color:#1e293b;">${greeting}</p>
        <p style="color:#374151;line-height:1.6;">
          You have been invited to your leasing portal for
          <strong>${args.lesseeName}</strong>. Set up your account using the
          link below to view your contracts and invoices, make payments,
          sign renewals, upload documents, and report issues online.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}"
             style="display:inline-block;background:#0891b2;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
            Set up my access
          </a>
        </p>
        <p style="color:#64748b;font-size:12px;">
          This link expires on ${new Date(args.expiresAt).toLocaleDateString()}. If you didn't
          expect this email, you can safely ignore it.
        </p>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center;">Fleet360 Platform</p>
    </div>
  `;

  const r = await sendEmail({ to: args.recipientEmail, subject, html });
  if (r.sent) return { ok: true };
  return {
    ok: false,
    reason: r.reason === 'not_configured'
      ? 'No email transport configured — set up an EMAIL integration, or set SENDGRID_API_KEY + EMAIL_FROM in the environment.'
      : (r.error ?? r.reason ?? 'Email send failed.'),
  };
}
