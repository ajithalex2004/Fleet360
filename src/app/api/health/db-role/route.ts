/**
 * GET /api/health/db-role
 *
 * Post-Deployment Staging Runtime Role Assertion Endpoint.
 *
 * Verifies that the deployed live server is actively connected to PostgreSQL
 * under the exact non-bypass role "fleet360_app" for both application traffic
 * and background sweep connections.
 *
 * Zero Information Disclosure:
 * Returns minimal boolean verification status without leaking internal usernames,
 * hostnames, connection strings, or database metadata.
 *
 * Protected by secret header `x-deployment-health-secret` or `Authorization: Bearer ...`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedSweepPrisma } from '@/lib/prisma-sweep';

export const dynamic = 'force-dynamic';

interface RoleRow {
  current_user: string;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

export async function GET(req: NextRequest) {
  const secretHeader =
    req.headers.get('x-deployment-health-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  const expectedSecret =
    process.env.DEPLOYMENT_HEALTH_SECRET ||
    process.env.INTERNAL_SERVICE_KEY ||
    process.env.SESSION_SECRET;

  // Strict Authorization: Require secret if configured in environment
  if (expectedSecret && secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // If no secret is configured in dev/local, still forbid external unauthenticated sniffing
  if (!expectedSecret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Endpoint disabled: DEPLOYMENT_HEALTH_SECRET not set' }, { status: 403 });
  }

  try {
    // 1. Probe Application Runtime Client
    const appRoles = await prisma.$queryRawUnsafe<RoleRow[]>(`
      SELECT current_user, rolcanlogin, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const appRole = appRoles[0];

    // 2. Probe Sweep Runtime Client
    const { client: sweepClient } = await getVerifiedSweepPrisma();
    const sweepRoles = await sweepClient.$queryRawUnsafe<RoleRow[]>(`
      SELECT current_user, rolcanlogin, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const sweepRole = sweepRoles[0];

    const runtimeRoleValid =
      appRole?.current_user === 'fleet360_app' &&
      appRole?.rolcanlogin === true &&
      appRole?.rolbypassrls === false &&
      appRole?.rolsuper === false;

    const directRoleValid =
      sweepRole?.current_user === 'fleet360_app' &&
      sweepRole?.rolcanlogin === true &&
      sweepRole?.rolbypassrls === false &&
      sweepRole?.rolsuper === false;

    if (runtimeRoleValid && directRoleValid) {
      return NextResponse.json({
        status: 'pass',
        runtimeRoleValid: true,
        directRoleValid: true,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          status: 'fail',
          runtimeRoleValid: Boolean(runtimeRoleValid),
          directRoleValid: Boolean(directRoleValid),
          error: 'Runtime role validation failed: non-conforming role credentials detected',
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        status: 'fail',
        runtimeRoleValid: false,
        directRoleValid: false,
        error: 'Database connection failed during probe',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
