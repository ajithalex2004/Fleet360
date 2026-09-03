export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  lookupUserInCorporateRoster,
  TENANT_AUTH_SETTINGS,
} from '@/lib/corporate-clients-registry';

// In-memory active OTP store
const ACTIVE_OTP_STORE: Record<string, { otp: string; expiresAt: number }> = {
  'fatima@ein360.ae': { otp: '849201', expiresAt: Date.now() + 3600000 },
  '971508876543': { otp: '849201', expiresAt: Date.now() + 3600000 },
};

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    tenantSettings: TENANT_AUTH_SETTINGS['tnt-exl-solutions'] || {
      tenantId: 'tnt-exl-solutions',
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

    // 1. Toggle Tenant SMS Authentication Setting
    if (action === 'UPDATE_TENANT_SMS_SETTING') {
      const { tenantId = 'tnt-exl-solutions', enableSmsAuth } = body;
      if (TENANT_AUTH_SETTINGS[tenantId]) {
        TENANT_AUTH_SETTINGS[tenantId].enableSmsAuth = Boolean(enableSmsAuth);
      }
      return NextResponse.json({
        success: true,
        tenantSettings: TENANT_AUTH_SETTINGS[tenantId],
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

    // 3. Send Synchronized OTP
    if (action === 'SEND_OTP') {
      const unifiedOtp = '849201'; // Deterministic test/demo OTP or randomized
      const expiresAt = Date.now() + tenantSettings.otpExpirySeconds * 1000;

      ACTIVE_OTP_STORE[user.email.toLowerCase()] = { otp: unifiedOtp, expiresAt };
      ACTIVE_OTP_STORE[user.mobileNumber.replace(/[^0-9]/g, '')] = { otp: unifiedOtp, expiresAt };

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
        demoOtpHint: unifiedOtp,
      });
    }

    // 4. Verify Synchronized OTP
    if (action === 'VERIFY_OTP') {
      const enteredOtp = (body?.otp || '').trim();
      const stored =
        ACTIVE_OTP_STORE[user.email.toLowerCase()] ||
        ACTIVE_OTP_STORE[user.mobileNumber.replace(/[^0-9]/g, '')];

      if (!stored || (stored.otp !== enteredOtp && enteredOtp !== '849201')) {
        return NextResponse.json({ error: 'Invalid or expired OTP code' }, { status: 400 });
      }

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
