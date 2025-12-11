import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newUser = await prisma.user.create({
            data: body,
        });
        return NextResponse.json(newUser);
    } catch (error) {
        console.error('Error creating user:', error);
        return NextResponse.json({ error: `Failed to create user: ${(error as Error).message}` }, { status: 500 });
    }
}
