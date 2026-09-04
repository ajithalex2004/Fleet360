export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * Investigation notes for incidents.
 * Auto-creates `incident_notes` table.
 *
 * GET  /api/incidents/[id]/notes       — list notes for incident
 * POST /api/incidents/[id]/notes       — add note
 */

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        type NoteRow = { id: string; incident_id: string; note_type: string; content: string; author: string | null; created_at: string };
        const notes = await tx.$queryRawUnsafe<NoteRow[]>(
          `SELECT * FROM incident_notes WHERE incident_id = $1 ORDER BY created_at DESC`,
          params.id
        ).catch(() => [] as NoteRow[]);
        return NextResponse.json({ notes });
        } catch (err) {
        console.error('[incident_notes GET]', err);
        return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { noteType = 'INVESTIGATION', content, author } = body;
        if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

        type NoteRow = { id: string };
        const [note] = await tx.$queryRawUnsafe<NoteRow[]>(
          `INSERT INTO incident_notes (tenant_id, incident_id, note_type, content, author)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          tenantId, params.id, noteType, content.trim(), author || 'System'
        );
        return NextResponse.json({ id: note.id }, { status: 201 });
        } catch (err) {
        console.error('[incident_notes POST]', err);
        return NextResponse.json({ error: 'Failed to add note' }, { status: 500 });
      }
  });
}

