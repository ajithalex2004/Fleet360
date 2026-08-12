import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  return NextResponse.json({ id, note: 'Migrated to Go backend' });
}
