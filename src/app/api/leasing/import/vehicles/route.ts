/**
 * POST /api/leasing/import/vehicles
 *
 * Multipart form-data:
 *   file: the CSV file
 *   mode: 'preview' | 'commit' (default: preview)
 *
 * Preview returns the parsed rows + per-row validation errors so the user
 * can correct the source spreadsheet before committing.
 *
 * Commit only inserts rows that pass validation. Existing license plates
 * are skipped (logged as 'duplicate' errors); the rest of the import
 * continues so a single bad row doesn't block the whole batch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  parseCsv,
  commitCsvRows,
  type ImportResult,
  type ImportPreview,
} from '@/lib/csv-import';
import {
  vehicleImportSchema,
  vehicleHeaderAliases,
  type VehicleImportRow,
} from '@/lib/csv-import/schemas';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const config = {
  schema: vehicleImportSchema,
  headerAliases: vehicleHeaderAliases,
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const mode = (form.get('mode') as string) ?? 'preview';

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Send multipart form-data with a "file" field.' },
        { status: 400 },
      );
    }

    const csvText = await file.text();

    if (mode === 'preview') {
      const preview: ImportPreview<VehicleImportRow> = parseCsv(csvText, config);
      return NextResponse.json(preview);
    }

    if (mode !== 'commit') {
      return NextResponse.json(
        { error: `Unknown mode: ${mode}. Expected 'preview' or 'commit'.` },
        { status: 400 },
      );
    }

    const result: ImportResult = await commitCsvRows(csvText, config, async (row) => {
      // Skip if license plate already exists (idempotent re-imports).
      const existing = await prisma.vehicle.findUnique({
        where: { licensePlate: row.licensePlate },
      });
      if (existing) {
        throw new Error(`vehicle with licensePlate=${row.licensePlate} already exists`);
      }
      await prisma.vehicle.create({
        data: {
          make: row.make,
          model: row.model,
          type: row.type ?? null,
          year: row.year != null ? BigInt(row.year) : null,
          licensePlate: row.licensePlate,
          vin: row.vin ?? null,
          color: row.color ?? null,
          fuelType: row.fuelType ?? null,
          vehicleUsage: row.vehicleUsage ?? null,
          vehicleGroup: row.vehicleGroup ?? null,
          vehicleClass: row.vehicleClass ?? null,
          seatingCapacity: row.seatingCapacity ?? null,
          status: row.status ?? 'AVAILABLE',
          currentMileage: row.currentMileage != null ? BigInt(row.currentMileage) : null,
        },
      });
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'Vehicle',
      action: 'CREATE',
      details: `Bulk import: ${result.inserted} vehicles inserted, ${result.skipped} skipped (errors: ${result.errors.length}).`,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    captureException(err, { context: 'leasing.import.vehicles' });
    console.error('[import vehicles] error:', err);
    return NextResponse.json({ error: 'Failed to import vehicles' }, { status: 500 });
  }
}
