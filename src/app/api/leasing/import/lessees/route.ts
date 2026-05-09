/**
 * POST /api/leasing/import/lessees
 *
 * Same shape as the vehicle import: multipart form-data with `file` + `mode`.
 * Preview returns parsed rows + validation errors. Commit inserts valid rows
 * only. Discriminated B2B/B2C: corporate rows require tradeLicense; individual
 * rows require emiratesId + nationality.
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
  lesseeImportSchema,
  lesseeHeaderAliases,
  type LesseeImportRow,
} from '@/lib/csv-import/schemas';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const config = {
  schema: lesseeImportSchema,
  headerAliases: lesseeHeaderAliases,
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
      const preview: ImportPreview<LesseeImportRow> = parseCsv(csvText, config);
      return NextResponse.json(preview);
    }

    if (mode !== 'commit') {
      return NextResponse.json(
        { error: `Unknown mode: ${mode}. Expected 'preview' or 'commit'.` },
        { status: 400 },
      );
    }

    const result: ImportResult = await commitCsvRows(csvText, config, async (row) => {
      const data: any = {
        name: row.name,
        type: row.type,
        email: row.email ?? null,
        phone: row.phone ?? null,
        address: row.address ?? null,
        contactPerson: row.contactPerson ?? null,
      };
      if (row.type === 'corporate') {
        data.tradeLicense = row.tradeLicense;
      } else {
        data.emiratesId = row.emiratesId;
        data.nationality = row.nationality;
        if (row.licenseNo) data.licenseNo = row.licenseNo;
      }
      await prisma.lessee.create({ data });
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'Lessee',
      action: 'CREATE',
      details: `Bulk import: ${result.inserted} lessees inserted, ${result.skipped} skipped (errors: ${result.errors.length}).`,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    captureException(err, { context: 'leasing.import.lessees' });
    console.error('[import lessees] error:', err);
    return NextResponse.json({ error: 'Failed to import lessees' }, { status: 500 });
  }
}
