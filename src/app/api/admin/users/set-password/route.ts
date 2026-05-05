/**
 * POST /api/admin/users/set-password
 * Admin-only: set or reset a user's password.
 * Body: { userId: string, password: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

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

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Ensure password_hash column exists
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`
    ).catch(() => {});

    const hash = hashPassword(password);
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
      hash,
      userId,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[set-password]', err);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }
}
