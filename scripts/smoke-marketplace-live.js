#!/usr/bin/env node

const goBase = (process.env.GO_BACKEND_URL || 'http://localhost:8080').replace(/\/$/, '');
const nextBase = (process.env.FLEET360_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const bearer = process.env.FLEET360_BEARER_TOKEN || process.env.BACKEND_BEARER_TOKEN || '';
const sessionCookie = process.env.FLEET360_SESSION_COOKIE || '';
const createRfq = process.env.MARKETPLACE_SMOKE_CREATE_RFQ === '1';

function cookieHeader(raw) {
  if (!raw) return '';
  return raw.includes('=') ? raw : `xl-session=${raw}`;
}

async function requestJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error || body?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(`${init.method || 'GET'} ${url} failed: ${msg}`);
  }
  return body;
}

function goHeaders() {
  if (!bearer) {
    throw new Error('FLEET360_BEARER_TOKEN is required for Go backend smoke checks.');
  }
  return { Authorization: `Bearer ${bearer}` };
}

function printStep(label, value) {
  console.log(`[ok] ${label}${value ? `: ${value}` : ''}`);
}

async function main() {
  console.log('Marketplace live smoke');
  console.log(`Go backend: ${goBase}`);
  console.log(`Next app:   ${nextBase}`);

  const rfqBody = await requestJson(`${goBase}/api/v1/logistics/rfqs?status=OPEN`, { headers: goHeaders() });
  const rfqs = Array.isArray(rfqBody?.data) ? rfqBody.data : [];
  if (rfqs.length === 0) {
    throw new Error('No OPEN RFQs returned. Run `GO_ENV=development go run . seed-marketplace` or post a load first.');
  }
  const rfq = rfqs[0];
  printStep('loaded open RFQs', `${rfqs.length} found; using ${rfq.rfqNo || rfq.id}`);

  if (!rfq.shipment || !('bidCount' in rfq)) {
    throw new Error('RFQ response is missing shipment summary or bidCount; Go RFQ enrichment is not active.');
  }
  printStep('RFQ enrichment present', `${rfq.shipment.origin || 'origin'} → ${rfq.shipment.destination || 'destination'}, bids=${rfq.bidCount}`);

  const bidBody = await requestJson(`${goBase}/api/v1/logistics/rfqs/${rfq.id}/bids`, { headers: goHeaders() });
  const bids = Array.isArray(bidBody?.data) ? bidBody.data : [];
  if (bids.length === 0) {
    throw new Error(`RFQ ${rfq.rfqNo || rfq.id} has no bids. Seed data or submit carrier bids first.`);
  }
  const bid = bids[0];
  if (!bid.carrierName) {
    throw new Error('Bid response is missing carrierName; Go bid enrichment is not active.');
  }
  printStep('loaded bids cheapest-first', `${bids.length} found; cheapest ${bid.currency || 'AED'} ${Number(bid.amount).toFixed(2)} from ${bid.carrierName}`);

  const carriers = await requestJson(`${goBase}/api/v1/logistics/carriers?status=ACTIVE`, { headers: goHeaders() });
  printStep('loaded active carriers', `${Array.isArray(carriers?.data) ? carriers.data.length : 0} found`);

  const shipments = await requestJson(`${goBase}/api/v1/logistics/shipments?limit=20`, { headers: goHeaders() });
  printStep('loaded shipments', `${Array.isArray(shipments?.data) ? shipments.data.length : 0} found`);

  if (createRfq) {
    const postable = (shipments.data || []).find(s =>
      ['PRIVATE', 'DRAFT', ''].includes(String(s.marketplaceStatus || '').toUpperCase()) &&
      !['DELIVERED', 'POD_SUBMITTED', 'CLOSED', 'CANCELLED'].includes(String(s.status || '').toUpperCase())
    );
    if (!postable) {
      console.log('! MARKETPLACE_SMOKE_CREATE_RFQ=1 but no postable shipment was found; skipping create.');
    } else {
      const activeCarrierIds = (carriers.data || []).slice(0, 2).map(c => c.id).filter(Boolean);
      if (activeCarrierIds.length === 0) {
        console.log('! MARKETPLACE_SMOKE_CREATE_RFQ=1 but no active carriers were found; skipping create.');
      } else {
        const created = await requestJson(`${goBase}/api/v1/logistics/rfqs`, {
          method: 'POST',
          headers: goHeaders(),
          body: JSON.stringify({
            shipmentOrderId: postable.id,
            inviteScope: 'SELECTED_CARRIERS',
            invitedCarrierIds: activeCarrierIds,
            bidDeadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          }),
        });
        printStep('created RFQ through Go', created.rfqNo || created.id);
      }
    }
  }

  const cookie = cookieHeader(sessionCookie);
  if (!cookie) {
    console.log('! Skipping Next award dry-run: set FLEET360_SESSION_COOKIE to an xl-session value.');
    return;
  }

  const dryRun = await requestJson(`${nextBase}/api/logistics/rfqs/${rfq.id}/award`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({ bidId: bid.id, dryRun: true }),
  });
  if (!dryRun?.dryRun) {
    throw new Error('Award dry-run did not return dryRun=true.');
  }
  if (!dryRun.ok) {
    const blockers = Array.isArray(dryRun.complianceBlockers)
      ? dryRun.complianceBlockers.map(b => b.label || b.code).join('; ')
      : 'unknown blocker';
    throw new Error(`Award dry-run blocked: ${blockers}`);
  }
  printStep('award dry-run passed', `${dryRun.currency || bid.currency} ${Number(dryRun.carrierAmount || bid.amount).toFixed(2)}`);
}

main().catch(err => {
  console.error(`[fail] ${err.message}`);
  process.exitCode = 1;
});
