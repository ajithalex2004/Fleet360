import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

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
  try {
    const body = await req.json();
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

    // Step 1: Verify user exists via Prisma ORM (standard columns — always reliable)
    const userRecord = await prisma.user.findUnique({
      where: { id: user_id },
      select: { id: true },
    });
    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Step 2: Ensure password_hash column exists (not in Prisma schema — added out-of-band)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`
    ).catch(() => {});

    // Step 3: Fetch current password hash via raw SQL
    const rows = await prisma.$queryRawUnsafe<{ password_hash: string | null }[]>(
      `SELECT password_hash FROM "User" WHERE id = $1 LIMIT 1`,
      user_id
    );

    const storedHash = rows[0]?.password_hash ?? null;
    if (!storedHash) {
      // Account has no password set — allow setting a new one without verifying current
      // (e.g. SSO-only accounts getting a password for the first time)
    } else {
      const valid = verifyPassword(current_password, storedHash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
      }
    }

    // Hash and persist new password
    const newHash = hashPassword(new_password);
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      newHash,
      user_id
    );

    return NextResponse.json({ ok: true, message: 'Password changed successfully' });
  } catch (err: unknown) {
    console.error('[change-password]', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
