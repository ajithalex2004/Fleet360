/**
 * GET /api/assets/spm/assignees
 * Returns active platform users for the SPM user-picker.
 * Pulls directly from the User model (same source as Admin Hub).
 * Supports ?search= for live filtering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams.get('search') ?? '';

    const where: Record<string, unknown> = { isActive: true };
    if (search.trim()) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { username:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { department:{ contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        department: true,
        position: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 30,
    });

    // Shape for the picker: id, display_name, email, department, initials
    const result = users.map(u => ({
      id:           u.id,
      display_name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
      username:     u.username,
      email:        u.email ?? '',
      department:   u.department ?? '',
      position:     u.position ?? '',
      initials:     [u.firstName?.[0], u.lastName?.[0]].filter(Boolean).join('').toUpperCase()
                    || u.username.slice(0, 2).toUpperCase(),
    }));

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
