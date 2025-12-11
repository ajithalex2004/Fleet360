import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: params.id },
        });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        return NextResponse.json(user);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const body = await request.json();
        const updatedUser = await prisma.user.update({
            where: { id: params.id },
            data: body,
        });
        return NextResponse.json(updatedUser);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        await prisma.user.delete({
            where: { id: params.id },
        });
        return NextResponse.json({ message: 'User deleted' });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
    }
}
