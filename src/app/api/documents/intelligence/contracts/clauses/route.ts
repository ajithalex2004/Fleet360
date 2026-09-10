export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/intelligence/contracts/clauses
 * --------------------------------------------------
 * Retrieves indexed contract clauses, SLA penalties, and termination notice windows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const url = new URL(req.url);
      const documentId = url.searchParams.get('documentId');
      const query = url.searchParams.get('query')?.toLowerCase();

      let sql = `
        SELECT
          id,
          document_id as "documentId",
          clause_number as "clauseNumber",
          title,
          content,
          page_number as "pageNumber",
          obligation_type as "obligationType",
          penalty_aed as "penaltyAed",
          created_at as "createdAt"
        FROM contract_clauses_index
        WHERE tenant_id = $1
      `;
      const params: any[] = [tenantId];

      if (documentId) {
        sql += ` AND document_id = $2`;
        params.push(documentId);
      }

      sql += ` ORDER BY page_number ASC, created_at DESC LIMIT 50`;

      let clauses = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

      // Simple keyword filter if search query provided
      if (query && clauses.length > 0) {
        clauses = clauses.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.content.toLowerCase().includes(query) ||
            (c.obligationType && c.obligationType.toLowerCase().includes(query))
        );
      }

      return NextResponse.json({
        clauses,
        count: clauses.length,
      });
    } catch (err: any) {
      console.error('[ContractClausesAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
