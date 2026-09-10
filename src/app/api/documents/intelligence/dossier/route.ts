export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/documents/intelligence/dossier
 * ----------------------------------------
 * 360° Asset Knowledge Graph API
 * Retrieves a complete document dossier, compliance health score,
 * and commercial lineage for a specific Vehicle or Driver.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { getAssetDocumentDossier } from '@/lib/agents/document-intelligence/pipeline/asset-dossier';

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
      const entityId = url.searchParams.get('entityId') || undefined;
      const rawEntityType = url.searchParams.get('entityType')?.toUpperCase();
      const plateNumber = url.searchParams.get('plateNumber') || undefined;
      const vin = url.searchParams.get('vin') || undefined;
      const licenseNumber = url.searchParams.get('licenseNumber') || undefined;
      const emiratesId = url.searchParams.get('emiratesId') || undefined;

      // Infer entity type if not explicitly supplied
      let entityType: 'VEHICLE' | 'DRIVER' = 'VEHICLE';
      if (rawEntityType === 'DRIVER' || licenseNumber || emiratesId) {
        entityType = 'DRIVER';
      }

      if (!entityId && !plateNumber && !vin && !licenseNumber && !emiratesId) {
        return NextResponse.json(
          {
            error: 'At least one asset identifier is required (entityId, plateNumber, vin, licenseNumber, or emiratesId).',
          },
          { status: 400 }
        );
      }

      const dossier = await getAssetDocumentDossier({
        tenantId,
        entityType,
        entityId,
        plateNumber,
        vin,
        licenseNumber,
        emiratesId,
      });

      if (!dossier) {
        return NextResponse.json({ error: 'Asset not found or no documents registered.' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        dossier,
      });
    } catch (err: any) {
      console.error('[AssetDossierAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
  });
}
