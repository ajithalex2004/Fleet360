import { createElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { renderPdf } from '@/lib/pdf/render';
import { StatementPdf, type StatementPdfData, type StatementTransaction } from '@/lib/pdf/templates/statement';
import type { Lang } from '@/lib/pdf/theme';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { buildCustomerStatement } from '@/lib/finance/customer-statement';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360',
  tagline: 'Enterprise Mobility Finance',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@fleet360.app',
  trn: '',
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: sp.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const customerKey = sp.get('customer');
  if (!customerKey) {
    return NextResponse.json({ error: 'Customer is required' }, { status: 400 });
  }

  const from = sp.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = sp.get('to') ?? new Date().toISOString().slice(0, 10);
  const includeInactive = sp.get('includeInactive') === 'true';
  const moduleFilter = sp.get('module');
  const branch = sp.get('branch');
  const lang: Lang = sp.get('lang') === 'ar' ? 'ar' : 'en';
  const download = sp.get('download') === '1';

  const statement = await buildCustomerStatement({
    tenantId: ctx.tenantId,
    customerKey,
    includeInactive,
    from,
    to,
    module: moduleFilter,
    branch,
  });

  if (!statement || !statement.customer || !statement.ledger) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  const transactions: StatementTransaction[] = statement.ledger.entries.map((entry) => ({
    date: entry.date,
    type: entry.voucherType === 'Invoice'
      ? 'INVOICE'
      : entry.voucherType === 'Credit Note'
        ? 'CREDIT_NOTE'
        : entry.voucherType === 'Deposit'
          ? 'DEPOSIT'
          : entry.voucherType === 'Deposit Deduction'
            ? 'DEPOSIT_DEDUCTION'
            : entry.voucherType === 'Deposit Refund'
              ? 'DEPOSIT_REFUND'
              : 'PAYMENT',
    reference: entry.voucherNo,
    description: entry.description,
    debit: entry.debit || undefined,
    credit: entry.credit || undefined,
    runningBalance: entry.runningBalance,
  }));

  const data: StatementPdfData = {
    periodFrom: from,
    periodTo: to,
    vendor: VENDOR,
    lessee: {
      name: statement.customer.name,
      type: 'corporate',
      address: statement.customer.address,
      email: statement.customer.email,
    },
    openingBalance: statement.ledger.openingBalance,
    closingBalance: statement.ledger.endingBalance,
    transactions,
    currency: 'AED',
  };

  const buffer = await renderPdf(createElement(StatementPdf, { data, lang }));
  const filename = `SOA_${statement.customer.name.replace(/\s+/g, '_')}_${from}_${to}.pdf`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
