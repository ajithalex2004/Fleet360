import { NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function PATCH() {
  return NextResponse.json(
    {
      error: 'Leasing remarketing has been retired.',
      redirectTo: '/leasing',
    },
    { status: 410 }
  );
}
