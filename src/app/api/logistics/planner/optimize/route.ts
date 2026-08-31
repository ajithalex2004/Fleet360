export const dynamic = 'force-dynamic';

/**
 * Planner /optimize endpoint — STUB for type-check pass.
 *
 * Tests under tests/integration/planner-*.test.ts import the handler from here.
import { withTenantRls } from '@/lib/rls';
 * The original implementation was relocated to the Go backend (Layer 4 work)
 * and these Next.js routes will be re-implemented in a follow-up sprint.
 */
import { NextRequest, NextResponse } from 'next/server';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'Planner optimize endpoint has been migrated to the Go backend. Use POST /api/v1/go/planner/optimize in the meantime.',
      code: 'ENDPOINT_MIGRATED',
    },
    { status: 503 },
  );
}
