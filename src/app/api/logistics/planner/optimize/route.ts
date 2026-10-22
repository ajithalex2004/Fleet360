export const dynamic = 'force-dynamic';

/**
 * Planner /optimize endpoint — STUB for type-check pass.
 *
 * Tests under tests/integration/planner-*.test.ts import the handler from here.
 * The original implementation was relocated to the Go backend (Layer 4 work)
 * and these Next.js routes will be re-implemented in a follow-up sprint.
 */
import { NextRequest, NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(req: NextRequest): Promise<NextResponse> {
  // A stub, but still tenant-scoped: it answers only an authorized tenant.
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  return NextResponse.json(
    {
      error: 'Planner optimize endpoint has been migrated to the Go backend. Use POST /api/v1/go/planner/optimize in the meantime.',
      code: 'ENDPOINT_MIGRATED',
    },
    { status: 503 },
  );
}
