export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  lookupUserInCorporateRoster,
  TENANT_AUTH_SETTINGS,
} from '@/lib/corporate-clients-registry';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

interface StoredOtp {
  otp: string;
  expiresAt: number;
  attempts: number;
}

// In-memory active OTP store
const ACTIVE_OTP_STORE = new Map<string, StoredOtp>();

// Rate limiter for SEND_OTP: max 3 requests per minute per identifier
const SEND_OTP_RATE_LIMITS = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (SEND_OTP_RATE_LIMITS.get(key) || []).filter((ts) => now - ts < windowMs);
  if (timestamps.length >= 3) {
    return true;
  }
  timestamps.push(now);
  SEND_OTP_RATE_LIMITS.set(key, timestamps);
  return false;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  const tenantId = authz.ok ? authz.tenantId : 'tnt-exl-solutions';

  return NextResponse.json({
    success: true,
    tenantSettings: TENANT_AUTH_SETTINGS[tenantId] || {
      tenantId,
      enableSmsAuth: true,
      enableWhatsAppAuth: true,
      enableEmailAuth: true,
      otpExpirySeconds: 300,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action || 'SEND_OTP';

    // 1. Toggle Tenant SMS Authentication Setting (Requires TENANT_ADMIN / SUPER_ADMIN)
    if (action === 'UPDATE_TENANT_SMS_SETTING') {
      const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
      if (!authz.ok) {
        return NextResponse.json({ error: authz.error }, { status: authz.status });
      }
      if (authz.role !== 'TENANT_ADMIN' && authz.role !== 'SUPER_ADMIN') {
        return NextResponse.json(
          { error: 'Only TENANT_ADMIN or SUPER_ADMIN can update tenant SMS settings' },
          { status: 403 }
        );
      }

      const targetTenantId = (authz.role === 'SUPER_ADMIN' && body.tenantId)
        ? body.tenantId
        : authz.tenantId;

      const { enableSmsAuth } = body;
      if (!TENANT_AUTH_SETTINGS[targetTenantId]) {
        TENANT_AUTH_SETTINGS[targetTenantId] = {
          tenantId: targetTenantId,
          enableSmsAuth: Boolean(enableSmsAuth),
          enableWhatsAppAuth: true,
          enableEmailAuth: true,
          otpExpirySeconds: 300,
        };
      } else {
        TENANT_AUTH_SETTINGS[targetTenantId].enableSmsAuth = Boolean(enableSmsAuth);
      }

      return NextResponse.json({
        success: true,
        tenantSettings: TENANT_AUTH_SETTINGS[targetTenantId],
      });
    }

    const identifier = (body?.identifier || '').trim();
    if (!identifier) {
      return NextResponse.json({ error: 'Identifier (email or mobile) required' }, { status: 400 });
    }

    // 2. Lookup in Authorized Corporate User Roster
    const match = lookupUserInCorporateRoster(identifier);
    if (!match) {
      return NextResponse.json(
        {
          error: 'Identifier is not registered in an authorized corporate user roster.',
          notRegistered: true,
        },
        { status: 404 }
      );
    }

    const { client, user } = match;
    const tenantSettings = TENANT_AUTH_SETTINGS[client.tenantId] || {
      tenantId: client.tenantId,
      enableSmsAuth: true,
      enableWhatsAppAuth: true,
      enableEmailAuth: true,
      otpExpirySeconds: 300,
    };

    const emailKey = user.email.toLowerCase();
    const phoneKey = user.mobileNumber.replace(/[^0-9]/g, '');

    // 3. Send Synchronized OTP
    if (action === 'SEND_OTP') {
      if (isRateLimited(emailKey)) {
        return NextResponse.json(
          { error: 'Too many OTP requests. Please wait a minute before requesting another.' },
          { status: 429 }
        );
      }

      // Generate 6-digit CSPRNG OTP
      const generatedOtp = crypto.randomInt(100000, 1000000).toString();
      const expirySeconds = tenantSettings.otpExpirySeconds || 300;
      const expiresAt = Date.now() + expirySeconds * 1000;

      const storedEntry: StoredOtp = {
        otp: generatedOtp,
        expiresAt,
        attempts: 0,
      };

      ACTIVE_OTP_STORE.set(emailKey, storedEntry);
      ACTIVE_OTP_STORE.set(phoneKey, storedEntry);

      const channelsDispatched: string[] = [];
      if (tenantSettings.enableEmailAuth) channelsDispatched.push('EMAIL');
      if (tenantSettings.enableWhatsAppAuth) channelsDispatched.push('WHATSAPP');
      if (tenantSettings.enableSmsAuth) channelsDispatched.push('SMS');

      return NextResponse.json({
        success: true,
        message: `Unified OTP dispatched to ${user.name} via ${channelsDispatched.join(', ')}`,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mobileNumber: user.mobileNumber,
          role: user.role,
          costCenter: user.costCenter,
        },
        client: {
          id: client.id,
          name: client.clientName,
          domain: client.emailDomain,
          costCenter: client.costCenterCode,
          discountPercent: client.discountPercent,
        },
        channelsDispatched,
        enableSmsAuth: tenantSettings.enableSmsAuth,
      });
    }

    // 4. Verify Synchronized OTP
    if (action === 'VERIFY_OTP') {
      const enteredOtp = (body?.otp || '').trim();
      const stored = ACTIVE_OTP_STORE.get(emailKey) || ACTIVE_OTP_STORE.get(phoneKey);

      if (!stored || Date.now() > stored.expiresAt) {
        if (stored) {
          ACTIVE_OTP_STORE.delete(emailKey);
          ACTIVE_OTP_STORE.delete(phoneKey);
        }
        return NextResponse.json({ error: 'Invalid or expired OTP code' }, { status: 400 });
      }

      if (stored.attempts >= 5) {
        ACTIVE_OTP_STORE.delete(emailKey);
        ACTIVE_OTP_STORE.delete(phoneKey);
        return NextResponse.json(
          { error: 'Maximum verification attempts exceeded. Please request a new OTP.' },
          { status: 429 }
        );
      }

      if (stored.otp !== enteredOtp) {
        stored.attempts += 1;
        if (stored.attempts >= 5) {
          ACTIVE_OTP_STORE.delete(emailKey);
          ACTIVE_OTP_STORE.delete(phoneKey);
          return NextResponse.json(
            { error: 'Maximum verification attempts exceeded. Please request a new OTP.' },
            { status: 429 }
          );
        }
        return NextResponse.json({ error: 'Invalid or expired OTP code' }, { status: 400 });
      }

      // Successful verification: consume OTP
      ACTIVE_OTP_STORE.delete(emailKey);
      ACTIVE_OTP_STORE.delete(phoneKey);

      return NextResponse.json({
        success: true,
        verified: true,
        sessionToken: `sess-roster-${user.id}-${Date.now()}`,
        user,
        client,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[api/auth/roster-otp POST]', err);
    return NextResponse.json({ error: 'Failed to process roster OTP request' }, { status: 500 });
  }
}
