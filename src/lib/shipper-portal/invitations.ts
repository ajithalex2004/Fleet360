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
import { ensureShipperPortalTables } from './schema';
import { setPortalUserPassword } from './portal-users-store';

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
  await ensureShipperPortalTables();
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
  await ensureShipperPortalTables();
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
  await ensureShipperPortalTables();
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
 * Sends the setup link via the tenant's configured SMTP integration. Uses
 * the same IntegrationConfig type='EMAIL' pattern the workflow engine
 * already uses for outbound mail.
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
  try {
    // Read the tenant's active EMAIL integration. Falls back to the global
    // (tenantId IS NULL) row.
    const cfgRows = await prisma.$queryRawUnsafe<Array<{ config: unknown }>>(
      `SELECT config FROM "IntegrationConfig"
        WHERE type = 'EMAIL' AND "isActive" = true
          AND (tenant_id = $1 OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST
        LIMIT 1`,
      args.tenantId,
    ).catch(() => []);
    if (!cfgRows[0]) return { ok: false, reason: 'No active EMAIL integration configured.' };

    const raw = cfgRows[0].config as unknown;
    const config = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);

    const link = `${args.baseUrl.replace(/\/$/, '')}/shipper-portal/setup?token=${encodeURIComponent(args.rawToken)}`;
    const greeting = args.recipientName ? `Dear ${args.recipientName},` : 'Hello,';
    const subject = `Set up your Fleet360 portal access for ${args.customerName}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px;border-radius:10px;margin-bottom:24px;">
          <h1 style="color:white;margin:0;font-size:20px;">Fleet360 Portal Access</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">${args.customerName}</p>
        </div>
        <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0;">
          <p style="color:#1e293b;">${greeting}</p>
          <p style="color:#374151;line-height:1.6;">
            You have been invited to use the Fleet360 portal as a shipper for
            <strong>${args.customerName}</strong>. Set up your account using the
            link below to start placing shipment requests and tracking your shipments.
          </p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${link}"
               style="display:inline-block;background:#6366f1;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
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

    const nodemailer = await import('nodemailer');
    const cfg = config as Record<string, unknown>;
    const transporter = nodemailer.createTransport({
      host: String(cfg.smtpHost ?? ''),
      port: parseInt(String(cfg.smtpPort ?? '587')) || 587,
      secure: cfg.smtpSecure === true || String(cfg.smtpPort ?? '') === '465',
      auth: { user: String(cfg.smtpUser ?? ''), pass: String(cfg.smtpPassword ?? '') },
    });
    await transporter.sendMail({
      from: (cfg.fromEmail as string) ?? (cfg.smtpUser as string),
      to: args.recipientEmail,
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.warn('[shipper-portal] invitation email send failed:', e);
    return { ok: false, reason: e instanceof Error ? e.message : 'Unknown' };
  }
}
