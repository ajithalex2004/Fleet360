import { NextResponse } from 'next/server';

export async function PATCH() {
  return NextResponse.json(
    {
      error: 'Leasing remarketing has been retired.',
      redirectTo: '/leasing',
    },
    { status: 410 }
  );
}
