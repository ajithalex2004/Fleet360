import { NextResponse } from 'next/server';
import { getLeasingDocumentEntityOptions } from '@/lib/leasing-document-entities';

export async function GET() {
  try {
    const options = await getLeasingDocumentEntityOptions();
    return NextResponse.json(options);
  } catch (error) {
    console.error('GET /api/leasing/documents/options error:', error);
    return NextResponse.json({ error: 'Failed to fetch document entity options' }, { status: 500 });
  }
}
