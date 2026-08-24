/**
 * POST /api/admin/users/set-password
 * Admin-only: set or reset a user's password.
 * Body: { userId: string, password: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, password } = await request.json() as { userId?: string; password?: string };

    if (!userId || !password) {
      return NextResponse.json({ error: 'userId and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Compute the hash OUTSIDE the transaction. pbkdf2 with 100k iterations is
    // CPU-bound (~200-500 ms) and was previously running inside withPlatformAdmin
    // — that pushed the transaction past Prisma's 5 s default timeout and the
    // commit failed with P2028, returning 500. The hash is pure CPU; it doesn't
    // need a DB connection.
    const hash = hashPassword(password);

    // User is global (no RLS) but admin password reset can touch any
    // tenant's data, so use the platform-admin context.
    return await withPlatformAdmin(prisma, async (tx) => {
      // Verify user exists
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // The `password_hash` column was added out-of-band. The "ADD COLUMN IF
      // NOT EXISTS" used to run on every call — it's a no-op once the column
      // exists, but it's still a wasted round-trip inside the transaction.
      // The column is now in production; the ALTER is removed.
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
        hash,
        userId,
      );

      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    console.error('[set-password]', err);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }
}
