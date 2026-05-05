/**
 * POST /api/tenants/verify-domain  — Email link token verification
 * GET  /api/tenants/verify-domain?tenantId=X — DNS TXT record verification
 *
 * Public endpoint — no auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import dns from 'dns';
import { promisify } from 'util';
import { prisma } from '@/lib/prisma';

const resolveTxt = promisify(dns.resolveTxt);

// ── POST — Email token verification ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, tenantId } = body as { token?: string; tenantId?: string };

    if (!token || !tenantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'token and tenantId are required' },
        { status: 400 }
      );
    }

    // Look up the tenant and check the stored verification token
    type TenantVerify = { id: string; domain_verification_token: string | null; domain_verified_at: string | null };
    const rows = await prisma.$queryRawUnsafe<TenantVerify[]>(
      `SELECT id, domain_verification_token, domain_verified_at
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      tenantId,
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Tenant not found' },
        { status: 404 }
      );
    }

    const row = rows[0];

    if (row.domain_verified_at) {
      // Already verified — return success
      return NextResponse.json({ ok: true, verified: true, alreadyVerified: true });
    }

    if (!row.domain_verification_token || row.domain_verification_token !== token) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid verification token' },
        { status: 401 }
      );
    }

    // Mark as verified
    await prisma.$executeRawUnsafe(
      `UPDATE tenants
       SET domain_verified_at = NOW(), domain_verification_method = 'EMAIL'
       WHERE id = $1`,
      tenantId,
    );

    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    console.error('[verify-domain POST]', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Verification failed' },
      { status: 500 }
    );
  }
}

// ── GET — DNS TXT record verification ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'tenantId query parameter is required' },
        { status: 400 }
      );
    }

    type TenantDns = {
      id: string;
      domain: string | null;
      domain_verification_token: string | null;
      domain_verified_at: string | null;
    };

    const rows = await prisma.$queryRawUnsafe<TenantDns[]>(
      `SELECT id, domain, domain_verification_token, domain_verified_at
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      tenantId,
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Tenant not found' },
        { status: 404 }
      );
    }

    const row = rows[0];

    if (row.domain_verified_at) {
      return NextResponse.json({
        verified: true,
        method: 'EMAIL' as const,
        txtRecord: null,
      });
    }

    if (!row.domain) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Tenant has no domain configured' },
        { status: 400 }
      );
    }

    const expectedRecord = `xl-verify=${row.domain_verification_token ?? ''}`;
    let verified = false;
    let foundRecord: string | null = null;

    try {
      const records = await resolveTxt(row.domain);
      // resolveTxt returns string[][] — each record is an array of chunks
      for (const chunks of records) {
        const fullRecord = chunks.join('');
        if (fullRecord === expectedRecord) {
          verified = true;
          foundRecord = fullRecord;
          break;
        }
      }
    } catch (dnsErr: unknown) {
      const code = (dnsErr as NodeJS.ErrnoException).code;
      // ENOTFOUND / ENODATA means DNS lookup failed — not an error we throw on
      if (code !== 'ENOTFOUND' && code !== 'ENODATA' && code !== 'ESERVFAIL') {
        throw dnsErr;
      }
    }

    if (verified) {
      await prisma.$executeRawUnsafe(
        `UPDATE tenants
         SET domain_verified_at = NOW(), domain_verification_method = 'DNS_TXT'
         WHERE id = $1`,
        tenantId,
      );
    }

    return NextResponse.json({
      verified,
      method: verified ? ('DNS_TXT' as const) : null,
      txtRecord: foundRecord,
      expectedRecord,
    });
  } catch (err) {
    console.error('[verify-domain GET]', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'DNS verification failed' },
      { status: 500 }
    );
  }
}
