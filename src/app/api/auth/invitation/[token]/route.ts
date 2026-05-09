/**
 * GET /api/auth/invitation/[token]
 * Public — returns invitation context (tenant name, email, role, expiry,
 * whether the invited email already has a user account).
 *
 * Used by the /invitation/[token] accept page to render the right form.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureInvitationTable, hashInvitationToken } from '@/lib/invitations';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ token: string }>; }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  if (!token || token.length < 32) {
    return NextResponse.json({ ok: false, error: 'Invalid invitation link.' }, { status: 400 });
  }

  await ensureInvitationTable();
  const tokenHash = hashInvitationToken(token);

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; tenant_id: string; email: string; role_id: string; role_name: string;
    tenant_name: string; tenant_active: boolean;
    expires_at: string; used_at: string | null; revoked: boolean;
    existing_user_id: string | null;
  }>>(
    `SELECT i.id::text, i.tenant_id, i.email, i.role_id,
            r.name AS role_name,
            t.name AS tenant_name, t.is_active AS tenant_active,
            i.expires_at::text, i.used_at::text, i.revoked,
            u.id AS existing_user_id
     FROM tenant_invitations i
     LEFT JOIN roles   r ON r.id = i.role_id
     LEFT JOIN tenants t ON t.id = i.tenant_id
     LEFT JOIN "User"  u ON LOWER(u.email) = LOWER(i.email)
     WHERE i.token_hash = $1
     LIMIT 1`,
    tokenHash,
  ).catch(() => []);

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Invitation not found.' }, { status: 404 });
  }
  const r = rows[0];
  if (!r.tenant_active) {
    return NextResponse.json({ ok: false, error: 'This organisation is inactive.' }, { status: 400 });
  }
  if (r.used_at) return NextResponse.json({ ok: false, error: 'This invitation has already been accepted.' }, { status: 400 });
  if (r.revoked) return NextResponse.json({ ok: false, error: 'This invitation has been revoked.' }, { status: 400 });
  if (new Date(r.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: 'This invitation has expired.' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    invitation: {
      tenantName: r.tenant_name,
      email:      r.email,
      roleName:   r.role_name,
      expiresAt:  r.expires_at,
    },
    existingUser: !!r.existing_user_id,
  });
}
