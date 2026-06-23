import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as rawCarrierRfqList } from '@/app/api/logistics/carrier-portal/rfqs/route';
import { POST as rawCarrierBidSubmit } from '@/app/api/logistics/carrier-portal/rfqs/[id]/bid/route';

const root = process.cwd();

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('Logistics secure carrier portal', () => {
  it('rejects direct carrier RFQ list access without a secure invite token', async () => {
    const req = new NextRequest(
      'http://localhost/api/logistics/carrier-portal/rfqs?tenantId=t-1&carrierId=c-1',
    );

    const res = await rawCarrierRfqList(req);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toBe('Secure invite token is required');
  });

  it('rejects direct carrier bid submission without a secure invite token', async () => {
    const req = new NextRequest('http://localhost/api/logistics/carrier-portal/rfqs/rfq-1/bid', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: 't-1',
        carrierId: 'c-1',
        amount: 1000,
      }),
    });

    const res = await rawCarrierBidSubmit(req, { params: Promise.resolve({ id: 'rfq-1' }) });
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toBe('Secure invite token is required');
  });

  it('keeps the carrier portal UI on token-scoped APIs only', () => {
    const page = source('src/app/carrier-portal/logistics/page.tsx');

    expect(page).toContain('/api/logistics/carrier-portal/invites/');
    expect(page).toContain('/documents');
    expect(page).not.toContain('/api/logistics/carrier-portal/rfqs?');
    expect(page).not.toContain('Tenant ID');
    expect(page).not.toContain('Carrier ID');
  });

  it('returns structured compliance blockers before award and only allows Super Admin override', () => {
    const awardRoute = source('src/app/api/logistics/rfqs/[id]/award/route.ts');
    const domain = source('src/lib/logistics/domain.ts');

    expect(awardRoute).toContain('LOGISTICS_COMPLIANCE_BLOCKED');
    expect(awardRoute).toContain('blockers');
    expect(domain).toContain('REQUIRED_CARRIER_AWARD_DOCUMENTS');
    expect(domain).toContain("args.actorRole === 'SUPER_ADMIN'");
    expect(domain).toContain('Trade license');
    expect(domain).toContain('Carrier insurance');
    expect(domain).toContain('Driver documents');
  });

  it('supports Finance posting reversal without treating reversed postings as active duplicates', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const reverseRoute = source('src/app/api/logistics/shipments/[id]/finance-posting/[postingId]/route.ts');

    expect(domain).toContain('reverseLogisticsFinancePosting');
    expect(domain).toContain("status <> 'REVERSED'");
    expect(domain).toContain('FREIGHT_FINANCE_POSTING_REVERSED');
    expect(reverseRoute).toContain("body.action ?? 'reverse'");
    expect(reverseRoute).toContain('reverseLogisticsFinancePosting');
  });
});
