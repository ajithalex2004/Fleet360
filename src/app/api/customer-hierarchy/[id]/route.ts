import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const sets: string[] = [];
  if (body.name)        sets.push(`name = '${body.name.replace(/'/g,"''")}'`);
  if (body.code)        sets.push(`code = '${body.code.replace(/'/g,"''")}'`);
  if (body.description) sets.push(`description = '${body.description.replace(/'/g,"''")}'`);
  if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await prisma.$executeRawUnsafe(`UPDATE customer_hierarchy SET ${sets.join(', ')} WHERE id = '${params.id}'`);
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM customer_hierarchy WHERE id = '${params.id}'`);
  return NextResponse.json((rows as any[])[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`UPDATE customer_hierarchy SET is_active = false WHERE id = '${params.id}'`);
  return NextResponse.json({ success: true });
}
