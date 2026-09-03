export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  CORPORATE_CLIENTS_REGISTRY,
  CorporateClientRecord,
  AuthorizedClientUser,
} from '@/lib/corporate-clients-registry';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain');
    const clientId = searchParams.get('clientId');

    if (clientId) {
      const match = CORPORATE_CLIENTS_REGISTRY.find((c) => c.id === clientId);
      if (match) return NextResponse.json({ client: match });
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (domain) {
      const match = CORPORATE_CLIENTS_REGISTRY.find(
        (c) => c.emailDomain.toLowerCase() === domain.toLowerCase().trim()
      );
      if (match) return NextResponse.json({ client: match });
      return NextResponse.json({ error: 'Domain not registered' }, { status: 404 });
    }

    return NextResponse.json({ clients: CORPORATE_CLIENTS_REGISTRY });
  } catch (err) {
    console.error('[api/admin/corporate-clients GET]', err);
    return NextResponse.json({ error: 'Failed to fetch corporate clients' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action; // 'CREATE_CLIENT' | 'ADD_USER_TO_ROSTER' | 'DELETE_USER_FROM_ROSTER'

    // 1. Add User to Client's Roster
    if (action === 'ADD_USER_TO_ROSTER') {
      const { clientId, name, mobileNumber, email, role = 'LOGISTICS_LEAD', costCenter, maxSpendingLimitAed } = body;
      const client = CORPORATE_CLIENTS_REGISTRY.find((c) => c.id === clientId);
      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      }

      const newUser: AuthorizedClientUser = {
        id: `usr-${Date.now().toString().slice(-6)}`,
        name,
        mobileNumber,
        email,
        role,
        costCenter: costCenter || client.costCenterCode,
        maxSpendingLimitAed: maxSpendingLimitAed ? Number(maxSpendingLimitAed) : 10000,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };

      client.userRoster.push(newUser);
      return NextResponse.json({ success: true, user: newUser, client });
    }

    // 2. Delete User from Client's Roster
    if (action === 'DELETE_USER_FROM_ROSTER') {
      const { clientId, userId } = body;
      const client = CORPORATE_CLIENTS_REGISTRY.find((c) => c.id === clientId);
      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      }

      client.userRoster = client.userRoster.filter((u) => u.id !== userId);
      return NextResponse.json({ success: true, client });
    }

    // 3. Create or Update Corporate Client Account
    const {
      clientName,
      emailDomain,
      tenantId = 'tnt-exl-solutions',
      tenantName = 'EXL Solutions',
      costCenterCode,
      discountPercent = 10,
      creditLimitAed = 50000,
    } = body;

    if (!clientName || !emailDomain || !costCenterCode) {
      return NextResponse.json({ error: 'Missing required client fields' }, { status: 400 });
    }

    const cleanDomain = emailDomain.replace('@', '').toLowerCase().trim();
    const existingIdx = CORPORATE_CLIENTS_REGISTRY.findIndex(
      (c) => c.emailDomain === cleanDomain
    );

    const newRecord: CorporateClientRecord = {
      id: `cli-${cleanDomain.replace(/[^a-z0-9]/g, '')}-${Date.now().toString().slice(-4)}`,
      clientName,
      emailDomain: cleanDomain,
      tenantId,
      tenantName,
      costCenterCode,
      discountPercent: Number(discountPercent),
      billingMethod: 'CORPORATE_ACCOUNT',
      creditLimitAed: Number(creditLimitAed),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      userRoster: existingIdx >= 0 ? CORPORATE_CLIENTS_REGISTRY[existingIdx].userRoster : [],
    };

    if (existingIdx >= 0) {
      CORPORATE_CLIENTS_REGISTRY[existingIdx] = newRecord;
    } else {
      CORPORATE_CLIENTS_REGISTRY.push(newRecord);
    }

    return NextResponse.json({ success: true, client: newRecord });
  } catch (err) {
    console.error('[api/admin/corporate-clients POST]', err);
    return NextResponse.json({ error: 'Failed to process corporate client request' }, { status: 500 });
  }
}
