export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signRacPortalSession, buildRacSessionCookie } from '@/lib/rac-portal/auth';
import {
  findActiveRacUsersWithHashByEmail,
  markRacPortalUserLoggedIn,
} from '@/lib/rac-portal/portal-users-store';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  verifyPassword,
} from '@/lib/password-policy';
import { enforceRacPortalLoginRateLimit } from '../../_helpers';

const GENERIC_AUTH_ERROR = 'Invalid email or password';

// Precomputed valid PBKDF2-SHA512 hash used to equalize timing when no active user row matches
const DUMMY_PBKDF2_HASH = hashPassword('RacPortalConstantTimePad!2026#9');

const LoginSchema = z.object({
  email: z.string().trim().max(254).email('Please enter a valid corporate email address'),
  password: z.string().min(1, 'Password is required'),
  tenantCode: z.string().trim().max(120).optional().nullable(),
  tenantSlug: z.string().trim().max(120).optional().nullable(),
  tenantId: z.string().trim().max(120).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const rawEmailForLimiter =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;

    const rl = await enforceRacPortalLoginRateLimit(req, rawEmailForLimiter);
    if (rl) return rl;

    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Email and password are required' },
        { status: 400 },
      );
    }

    const { email, password, tenantCode, tenantSlug, tenantId } = parsed.data;
    const effectiveTenantSelector =
      tenantCode?.trim() || tenantSlug?.trim() || tenantId?.trim() || null;

    // Guard against multi-MB PBKDF2 DoS while maintaining constant-time PBKDF2 work
    if (password.length > MAX_PASSWORD_LENGTH) {
      verifyPassword(password.slice(0, MAX_PASSWORD_LENGTH), DUMMY_PBKDF2_HASH);
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    const candidates = await findActiveRacUsersWithHashByEmail(email, effectiveTenantSelector);
    if (candidates.length === 0) {
      verifyPassword(password.slice(0, MAX_PASSWORD_LENGTH), DUMMY_PBKDF2_HASH);
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    const matched = candidates.filter((candidate) =>
      verifyPassword(password, candidate.passwordHash),
    );

    if (matched.length === 0) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    const distinctTenants = new Set(matched.map((m) => m.tenantId));
    if ((matched.length > 1 || distinctTenants.size > 1) && !effectiveTenantSelector) {
      return NextResponse.json(
        {
          error:
            'Multiple corporate accounts match this email. Please enter your RAC provider code.',
          requiresTenantCode: true,
        },
        { status: 409 },
      );
    }

    const chosen = matched[0];
    await markRacPortalUserLoggedIn(chosen.tenantId, chosen.id);

    const { token } = signRacPortalSession({
      userId: chosen.id,
      customerId: chosen.customerId,
      tenantId: chosen.tenantId,
      sv: chosen.sessionVersion,
    });

    const { passwordHash: _omitted, ...safeUser } = chosen;
    void _omitted;

    const res = NextResponse.json({
      ok: true,
      user: {
        ...safeUser,
        lastLoginAt: new Date().toISOString(),
      },
    });
    res.headers.set('Set-Cookie', buildRacSessionCookie(token));
    return res;
  } catch (err) {
    console.error('[rac-portal/auth/login] POST failed:', err);
    return NextResponse.json({ error: 'Unable to sign in right now' }, { status: 500 });
  }
}
