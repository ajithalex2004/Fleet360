/**
 * POST /api/leasing/fuel/import
 *
 * Bulk-import fuel-card transactions from a CSV file.
 *
 * Accepts: multipart/form-data with `file` (text/csv).
 * Optional form fields:
 *   - dryRun=1                        — preview without writing
 *   - defaultContractId=<uuid>        — fallback contract for rows whose
 *                                        plate doesn't match any active contract
 *
 * Resolution order for contract:
 *   1. Match by license plate against LeaseContractVehicle (active first)
 *   2. defaultContractId form field (must belong to caller's tenant)
 *   3. Skip the row with an error (unmatched plate)
 *
 * Dedup: refuses to insert a row that exactly matches an existing
 * LeaseFuelLog on (contractId, fuelDate, liters, fuelCardNo).
 *
 * Tenant scoping: requires x-tenant-id. The plate map only considers the
 * caller's contract vehicles, and every created LeaseFuelLog row is stamped
 * with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseFuelCsv } from '@/lib/fuel-csv';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface ImportSummary {
  detectedFormat: string;
  totalRows: number;
  imported: number;
  skippedDuplicate: number;
  skippedUnmatchedPlate: number;
  parseErrors: { row: number; reason: string }[];
  importErrors: { row: number; reason: string }[];
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file (CSV) is required' }, { status: 400 });
    }
    const dryRun = form.get('dryRun') === '1';
    const defaultContractId = form.get('defaultContractId')?.toString() || null;

    // Verify the defaultContractId belongs to this tenant before we use it
    // as a fallback (otherwise a caller could route plates to a foreign
    // contract).
    let scopedDefaultContractId: string | null = null;
    if (defaultContractId) {
      const owned = await prisma.leaseContract2.findFirst({
        where: { id: defaultContractId, tenantId },
        select: { id: true },
      });
      if (owned) scopedDefaultContractId = owned.id;
    }

    const csvText = await file.text();
    const parsed = parseFuelCsv(csvText);

    if (parsed.rows.length === 0 && parsed.errors.length === 1 && parsed.errors[0].row === 0) {
      return NextResponse.json({ error: parsed.errors[0].reason, detectedFormat: parsed.detectedFormat }, { status: 400 });
    }

    // Build a plate → activeContractId map up front (scoped to tenant).
    const plates = [...new Set(parsed.rows.map(r => r.licensePlate).filter(Boolean) as string[])]
      .map(p => p.toUpperCase().replace(/\s+/g, ''));
    let plateMap = new Map<string, string>();
    if (plates.length > 0) {
      // LeaseContractVehicle is scoped via the parent contract, so we
      // join through contract.tenantId to filter by tenant.
      const cvs = await prisma.leaseContractVehicle.findMany({
        where: {
          licensePlate: { not: null },
          contract: { tenantId },
        },
        select: { licensePlate: true, contractId: true, status: true },
      });
      cvs.sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1));
      for (const cv of cvs) {
        if (!cv.licensePlate) continue;
        const norm = cv.licensePlate.toUpperCase().replace(/\s+/g, '');
        if (!plateMap.has(norm)) plateMap.set(norm, cv.contractId);
      }
    }

    const summary: ImportSummary = {
      detectedFormat: parsed.detectedFormat,
      totalRows: parsed.rows.length,
      imported: 0,
      skippedDuplicate: 0,
      skippedUnmatchedPlate: 0,
      parseErrors: parsed.errors,
      importErrors: [],
    };

    const toInsert: Array<{
      rowIndex: number;
      data: {
        contractId: string;
        fuelDate: Date;
        liters: number;
        costPerLiter: number | null;
        totalCost: number;
        station: string | null;
        mileageAtFuel: number | null;
        fuelCardNo: string | null;
        billedToLessee: boolean;
        billingStatus: string;
        notes: string;
        tenantId: string;
      };
    }> = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const normPlate = r.licensePlate ? r.licensePlate.toUpperCase().replace(/\s+/g, '') : null;
      const contractId = (normPlate && plateMap.get(normPlate)) ?? scopedDefaultContractId;
      if (!contractId) {
        summary.skippedUnmatchedPlate += 1;
        summary.importErrors.push({ row: i + 2, reason: `No contract matched plate "${r.licensePlate ?? '(blank)'}" — set defaultContractId or update LeaseContractVehicle` });
        continue;
      }

      // Dedup against existing logs (scoped to this tenant).
      const existing = await prisma.leaseFuelLog.findFirst({
        where: {
          tenantId,
          contractId,
          fuelDate: r.fuelDate,
          liters: r.liters,
          ...(r.fuelCardNo ? { fuelCardNo: r.fuelCardNo } : {}),
        },
        select: { id: true },
      });
      if (existing) {
        summary.skippedDuplicate += 1;
        continue;
      }

      toInsert.push({
        rowIndex: i,
        data: {
          contractId,
          fuelDate: r.fuelDate,
          liters: r.liters,
          costPerLiter: r.costPerLiter,
          totalCost: r.totalCost,
          station: r.station,
          mileageAtFuel: r.mileageAtFuel,
          fuelCardNo: r.fuelCardNo,
          billedToLessee: true,
          billingStatus: 'PENDING',
          notes: `Imported from ${parsed.detectedFormat} CSV ${new Date().toISOString().slice(0, 10)}`,
          tenantId,
        },
      });
    }

    if (dryRun) {
      summary.imported = toInsert.length;
      return NextResponse.json({ dryRun: true, summary });
    }

    for (const item of toInsert) {
      try {
        await prisma.leaseFuelLog.create({ data: item.data });
        summary.imported += 1;
      } catch (err) {
        summary.importErrors.push({ row: item.rowIndex + 2, reason: err instanceof Error ? err.message : 'Insert failed' });
      }
    }

    if (summary.imported > 0) {
      void logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'LeaseFuelLog',
        action: 'CREATE',
        details: `Fuel CSV import (${parsed.detectedFormat}): ${summary.imported} imported, ${summary.skippedDuplicate} duplicates skipped, ${summary.skippedUnmatchedPlate} unmatched plates, ${summary.parseErrors.length} parse errors.`,
      });
    }

    return NextResponse.json({ dryRun: false, summary });
  } catch (err) {
    captureException(err, { context: 'leasing.fuel.import' });
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
