import { NextResponse } from 'next/server';

const RETIRED_REMARKETING_RESPONSE = {
  error: 'Leasing remarketing has been retired.',
  redirectTo: '/leasing',
};

export async function GET() {
  return NextResponse.json(RETIRED_REMARKETING_RESPONSE, { status: 410 });
}

export async function POST() {
  return NextResponse.json(RETIRED_REMARKETING_RESPONSE, { status: 410 });
}
