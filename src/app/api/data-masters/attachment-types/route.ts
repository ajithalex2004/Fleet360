/**
 * /api/data-masters/attachment-types — tenant-scoped Attachment Type Master.
 *
 * Replaces the in-memory mock that was wired into the
 * /maintenance/data-masters/attachment-types page. The list endpoint
 * supports an optional ?appliesTo=MAINTENANCE filter that the new ticket
 * form uses to only offer relevant attachment categories.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  listAttachmentTypes,
  createAttachmentType,
} from '@/lib/data-masters/attachment-types';

export async function GET(req: NextRequest) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true';
    const appliesTo  = req.nextUrl.searchParams.get('appliesTo') ?? undefined;
    const types = await listAttachmentTypes(auth.tenantId, { activeOnly, appliesTo });
    return NextResponse.json(
      { types },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('[attachment-types] GET error:', e);
    return NextResponse.json({ error: 'Failed to load attachment types' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    if (!body?.code || !body?.name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 });
    }
    const created = await createAttachmentType(auth.tenantId, body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    console.error('[attachment-types] POST error:', e);
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'An attachment type with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to create' }, { status: 500 });
  }
}
