import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// ── PBKDF2 helpers — must match /api/auth/login and /api/tenants/provision ──

function verifyPassword(plaintext: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { current_password, new_password } = body;

    // Always prefer the JWT-verified middleware header — it comes from the signed
    // session cookie and cannot be spoofed by the client.  Fall back to body only
    // when the middleware header is absent (e.g. direct API calls in tests).
    const user_id = req.headers.get('x-user-id') || body.user_id;

    console.log('[change-password] user_id from header:', req.headers.get('x-user-id'), '| from body:', body.user_id);

    if (!user_id || !current_password || !new_password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    if (new_password.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Read + verify + hash are intentionally split so the two pbkdf2 calls
    // (CPU-bound, ~200-500 ms each) and the ALTER (a no-op round-trip once
    // the column exists) do NOT happen inside the transaction. They used to
    // push the work past Prisma's 5 s default timeout, killing the commit
    // with P2028 and returning 500. The User table is global (no RLS), so
    // the pre-read can run on the bare client.

    // 1. Pre-read: user + stored hash (no tx — User has no RLS, no need for
    //    the platform-admin GUC here, but we keep the wrap for consistency
    //    with how the rest of the codebase reads the User table).
    const precheck = await withPlatformAdmin(prisma, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: user_id }, select: { id: true } });
      if (!u) return null;
      const rows = await tx.$queryRawUnsafe<{ password_hash: string | null }[]>(
        `SELECT password_hash FROM "User" WHERE id = $1 LIMIT 1`,
        user_id,
      );
      return rows[0]?.password_hash ?? null;
    });
    if (precheck === null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const storedHash = precheck;

    // 2. Verify the current password (CPU — outside any transaction).
    if (storedHash) {
      const valid = verifyPassword(current_password, storedHash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
      }
    }
    // If storedHash is null (no password set yet — e.g. SSO-only account
    // getting a password for the first time), we skip verify and proceed.

    // 3. Hash the new password (CPU — outside any transaction).
    const newHash = hashPassword(new_password);

    // 4. Persist inside a short transaction. Only SQL, no CPU.
    // NOTE: User table is legacy — column is camelCase "updatedAt" (quoted at
    // CREATE TABLE time), not snake_case. Prisma model has no @map on it.
    // Unquoted identifiers in Postgres fold to lowercase, so this MUST be quoted.
    return withPlatformAdmin(prisma, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1, "updatedAt" = NOW() WHERE id = $2`,
        newHash,
        user_id,
      );
      return NextResponse.json({ ok: true, message: 'Password changed successfully' });
    });
    } catch (err) {
    console.error('[change-password]', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
