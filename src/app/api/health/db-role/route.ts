/**
 * GET /api/health/db-role
 *
 * Post-Deployment Staging Runtime Role Assertion Endpoint.
 *
 * Verifies that the deployed live server is actively connected to PostgreSQL
 * under the exact non-bypass role "fleet360_app" for both application traffic
 * and background sweep connections.
 *
 * Protected by secret header `x-deployment-health-secret` (or SESSION_SECRET).
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
  const secretHeader = req.headers.get('x-deployment-health-secret');
  const expectedSecret = process.env.DEPLOYMENT_HEALTH_SECRET || process.env.SESSION_SECRET;

  if (expectedSecret && secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized deployment probe' }, { status: 401 });
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
    const { client: sweepClient, concurrency } = await getVerifiedSweepPrisma();
    const sweepRoles = await sweepClient.$queryRawUnsafe<RoleRow[]>(`
      SELECT current_user, rolcanlogin, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const sweepRole = sweepRoles[0];

    const appOk =
      appRole?.current_user === 'fleet360_app' &&
      appRole?.rolcanlogin === true &&
      appRole?.rolbypassrls === false &&
      appRole?.rolsuper === false;

    const sweepOk =
      sweepRole?.current_user === 'fleet360_app' &&
      sweepRole?.rolcanlogin === true &&
      sweepRole?.rolbypassrls === false &&
      sweepRole?.rolsuper === false;

    if (appOk && sweepOk) {
      return NextResponse.json({
        status: 'pass',
        deployedRole: 'fleet360_app',
        appConnection: {
          role: appRole.current_user,
          bypassRls: appRole.rolbypassrls,
          superUser: appRole.rolsuper,
          canLogin: appRole.rolcanlogin,
        },
        sweepConnection: {
          role: sweepRole.current_user,
          bypassRls: sweepRole.rolbypassrls,
          superUser: sweepRole.rolsuper,
          concurrency,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          status: 'fail',
          error: 'Deployed runtime role is not strictly fleet360_app (non-bypass)',
          appConnection: appRole,
          sweepConnection: sweepRole,
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        status: 'fail',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
