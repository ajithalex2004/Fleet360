import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Investigation notes for incidents.
 * Auto-creates `incident_notes` table.
 *
 * GET  /api/incidents/[id]/notes       — list notes for incident
 * POST /api/incidents/[id]/notes       — add note
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS incident_notes (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id UUID        NOT NULL,
      note_type   TEXT        NOT NULL DEFAULT 'INVESTIGATION', -- INVESTIGATION | ESCALATION | UPDATE | RESOLUTION
      content     TEXT        NOT NULL,
      author      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_incident_notes_inc ON incident_notes(incident_id)
  `);
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureTable();
    type NoteRow = { id: string; incident_id: string; note_type: string; content: string; author: string | null; created_at: string };
    const notes = await prisma.$queryRawUnsafe<NoteRow[]>(
      `SELECT * FROM incident_notes WHERE incident_id = $1 ORDER BY created_at DESC`,
      params.id
    ).catch(() => [] as NoteRow[]);
    return NextResponse.json({ notes });
  } catch (err) {
    console.error('[incident_notes GET]', err);
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureTable();
    const { noteType = 'INVESTIGATION', content, author } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

    type NoteRow = { id: string };
    const [note] = await prisma.$queryRawUnsafe<NoteRow[]>(
      `INSERT INTO incident_notes (incident_id, note_type, content, author)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      params.id, noteType, content.trim(), author || 'System'
    );
    return NextResponse.json({ id: note.id }, { status: 201 });
  } catch (err) {
    console.error('[incident_notes POST]', err);
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 });
  }
}
