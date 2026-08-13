/**
 * tests/integration/staff-transport-driver-reports.test.ts
 *
 * End-to-end integration test for the driver-reports pipeline.
 * Exercises the driver APIs (create / list / get / cancel) + the
 * dispatcher ack endpoint + the state machine + tenant scoping.
 *
 * Run: npx vitest run tests/integration/staff-transport-driver-reports.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let seed: SeedResult | undefined;
const createdReportIds: string[] = [];

beforeAll(async () => {
  if (!(await isServerRunning())) {
    throw new Error('dev server must be running on :3000 — start with `npm run dev`');
  }
  seed = await seedTestTenantFull();
});

afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    if (createdReportIds.length > 0) {
      for (const id of createdReportIds) {
        await prisma.$executeRaw`DELETE FROM driver_reports WHERE id = ${id}::uuid`;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe('Driver reports — driver side', () => {
  it('POST /reports creates a MAINTENANCE request, status=OPEN', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'MAINTENANCE',
      title: 'Brakes feel soft',
      description: 'Pedal goes further than usual',
      lat: 25.20, lng: 55.27, accuracyM: 12,
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.status).toBe('OPEN');
    expect(body.kind).toBe('REQUEST');
    expect(body.type).toBe('MAINTENANCE');
    createdReportIds.push(body.id);
  });

  it('POST /reports rejects type mismatch (REQUEST with ACCIDENT type)', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'ACCIDENT',
      title: 'wrong',
    }, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('POST /reports rejects severity on REQUEST', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'WASHING',
      title: 'car wash',
      severity: 'HIGH',
    }, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('POST /reports requires title (non-empty)', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'MAINTENANCE',
      title: '',
    }, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('POST /reports creates an INCIDENT with severity', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT',
      type: 'BREAKDOWN',
      severity: 'CRITICAL',
      title: 'Engine seized on Sheikh Zayed Rd',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.kind).toBe('INCIDENT');
    expect(body.status).toBe('OPEN');
    createdReportIds.push(body.id);
  });

  it('GET /reports returns the driver\'s reports, newest first', async () => {
    const r = await makeRequest('GET', '/api/driver-app/reports?limit=10', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.reports.length).toBeGreaterThanOrEqual(2);
    // Newest first
    for (let i = 0; i < body.reports.length - 1; i++) {
      expect(new Date(body.reports[i].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(body.reports[i + 1].createdAt).getTime());
    }
  });

  it('GET /reports?kind=INCIDENT filters correctly', async () => {
    const r = await makeRequest('GET', '/api/driver-app/reports?kind=INCIDENT&limit=10', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    for (const rep of body.reports) {
      expect(rep.kind).toBe('INCIDENT');
    }
  });

  it('GET /reports?status=OPEN filters correctly', async () => {
    const r = await makeRequest('GET', '/api/driver-app/reports?status=OPEN&limit=10', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    for (const rep of body.reports) {
      expect(rep.status).toBe('OPEN');
    }
  });

  it('GET /reports/[id] returns the full row (driver-scoped)', async () => {
    const id = createdReportIds[0];
    const r = await makeRequest('GET', `/api/driver-app/reports/${id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(id);
    expect(body.status).toBe('OPEN');
  });

  it('GET /reports/[id] returns 404 for unknown report', async () => {
    const r = await makeRequest('GET', '/api/driver-app/reports/00000000-0000-0000-0000-000000000000', undefined, seed!.headers);
    expect(r.status).toBe(404);
  });
});

describe('Driver reports — dispatcher side', () => {
  it('POST /dispatcher/reports/[id]/acknowledge transitions OPEN → ACK', async () => {
    const id = createdReportIds[0];
    const r = await makeRequest('POST', `/api/dispatcher/reports/${id}/acknowledge`, {
      notes: 'On it — calling maintenance now',
    }, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ACK');
    expect(body.notes).toBe('On it — calling maintenance now');
  });

  it('re-acknowledge is idempotent (200 + idempotent=true)', async () => {
    const id = createdReportIds[0];
    const r = await makeRequest('POST', `/api/dispatcher/reports/${id}/acknowledge`, null, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.idempotent).toBe(true);
  });
});

describe('Driver reports — driver cancel', () => {
  it('driver CAN cancel an OPEN report → CANCELLED', async () => {
    // Create a fresh OPEN report (the first one is now ACK)
    const cr = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'WASHING',
      title: 'Test cancel',
    }, seed!.headers);
    expect(cr.status).toBe(201);
    const crBody = await cr.json();
    const id = crBody.id as string;
    createdReportIds.push(id);

    const r = await makeRequest('POST', `/api/driver-app/reports/${id}/cancel`, null, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('CANCELLED');
  });

  it('re-cancel is idempotent (200 + idempotent=true)', async () => {
    // Pick one of the OPEN ones — actually all we created are now ACK or CANCELLED.
    // Create a new one to test idempotency.
    const cr = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST',
      type: 'RENEWAL',
      title: 'Test idempotent cancel',
    }, seed!.headers);
    const crBody = await cr.json();
    const id = crBody.id as string;
    createdReportIds.push(id);

    await makeRequest('POST', `/api/driver-app/reports/${id}/cancel`, null, seed!.headers);
    const r2 = await makeRequest('POST', `/api/driver-app/reports/${id}/cancel`, null, seed!.headers);
    expect(r2.status).toBe(200);
    const r2Body = await r2.json();
    expect(r2Body.idempotent).toBe(true);
  });

  it('driver CANNOT cancel an ACK report (409)', async () => {
    // createdReportIds[0] is ACK by now
    const id = createdReportIds[0];
    const r = await makeRequest('POST', `/api/driver-app/reports/${id}/cancel`, null, seed!.headers);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.reason).toMatch(/chat/i);
  });
});

describe('Driver reports — auth', () => {
  it('POST /reports returns 401 when unauthenticated', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'MAINTENANCE', title: 'no auth',
    });
    expect(r.status).toBe(401);
  });
  it('GET /reports returns 401 when unauthenticated', async () => {
    const r = await makeRequest('GET', '/api/driver-app/reports');
    expect(r.status).toBe(401);
  });
  it('POST /dispatcher/.../acknowledge returns 401 when unauthenticated', async () => {
    const r = await makeRequest('POST', '/api/dispatcher/reports/00000000-0000-0000-0000-000000000000/acknowledge');
    expect(r.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Sub-type catalogue + default severity auto-fill
// (the v2 driver-reports feature)
// ──────────────────────────────────────────────────────────────────────

describe('Driver reports — sub-type catalogue', () => {
  it('MAINTENANCE accepts each of the 4 maintenance sub-types', async () => {
    for (const subtype of ['PREVENTIVE', 'CORRECTIVE', 'SCHEDULED', 'BREAKDOWN_ACCIDENT']) {
      const r = await makeRequest('POST', '/api/driver-app/reports', {
        kind: 'REQUEST', type: 'MAINTENANCE', subtype, title: `mt-${subtype}`,
      }, seed!.headers);
      expect(r.status, `subtype=${subtype}`).toBe(201);
      const body = await r.json();
      expect(body.subtype).toBe(subtype);
      createdReportIds.push(body.id);
    }
  });

  it('RENEWAL accepts each of the 4 renewal sub-types', async () => {
    for (const subtype of ['INSURANCE', 'REGISTRATION', 'LICENSE', 'PERMITS_CERTIFICATIONS']) {
      const r = await makeRequest('POST', '/api/driver-app/reports', {
        kind: 'REQUEST', type: 'RENEWAL', subtype, title: `rn-${subtype}`,
      }, seed!.headers);
      expect(r.status, `subtype=${subtype}`).toBe(201);
      const body = await r.json();
      expect(body.subtype).toBe(subtype);
      createdReportIds.push(body.id);
    }
  });

  it('WASHING accepts each of the 4 washing sub-types', async () => {
    for (const subtype of ['BODY_WASH', 'FULL_WASH', 'INTERIOR', 'EXTERIOR']) {
      const r = await makeRequest('POST', '/api/driver-app/reports', {
        kind: 'REQUEST', type: 'WASHING', subtype, title: `ws-${subtype}`,
      }, seed!.headers);
      expect(r.status, `subtype=${subtype}`).toBe(201);
      const body = await r.json();
      expect(body.subtype).toBe(subtype);
      createdReportIds.push(body.id);
    }
  });

  it('rejects MAINTENANCE sub-type on RENEWAL (catalogue mismatch)', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'RENEWAL', subtype: 'PREVENTIVE', title: 'wrong cat',
    }, seed!.headers);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/subtype 'PREVENTIVE' is not valid for type 'RENEWAL'/);
  });

  it('rejects unknown sub-type', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'MAINTENANCE', subtype: 'BANANA', title: 'nope',
    }, seed!.headers);
    expect(r.status).toBe(400);
  });

  it('rejects sub-type on INCIDENT (subtypes are REQUEST-only)', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'ACCIDENT', subtype: 'PREVENTIVE', title: 'wrong kind',
    }, seed!.headers);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/subtype is only valid for REQUEST/);
  });

  it('subtype is optional — REQUEST without subtype is accepted', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'MAINTENANCE', title: 'no subtype',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.subtype).toBeNull();
    createdReportIds.push(body.id);
  });

  it('GET /reports returns subtype in the row', async () => {
    // Create one with a known subtype
    const cr = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'WASHING', subtype: 'INTERIOR', title: 'get-back-test',
    }, seed!.headers);
    expect(cr.status).toBe(201);
    const id = (await cr.json()).id as string;
    createdReportIds.push(id);

    // Fetch it back
    const r = await makeRequest('GET', `/api/driver-app/reports/${id}`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.subtype).toBe('INTERIOR');
  });

  it('GET /reports?subtype= filters by sub-type', async () => {
    // Create one with PREVENTIVE so the filter is meaningful
    const cr = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'MAINTENANCE', subtype: 'PREVENTIVE', title: 'filter-test',
    }, seed!.headers);
    expect(cr.status).toBe(201);
    const id = (await cr.json()).id as string;
    createdReportIds.push(id);

    const r = await makeRequest('GET', '/api/driver-app/reports?subtype=PREVENTIVE&limit=50', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.reports.length).toBeGreaterThan(0);
    for (const rep of body.reports) {
      expect(rep.subtype).toBe('PREVENTIVE');
    }
    expect(body.reports.some((rep: { id: string }) => rep.id === id)).toBe(true);
  });
});

describe('Driver reports — incident severity auto-fill', () => {
  it('ACCIDENT without severity auto-fills to HIGH', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'ACCIDENT', title: 'no sev',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('HIGH');
    createdReportIds.push(body.id);
  });

  it('BREAKDOWN without severity auto-fills to HIGH', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'BREAKDOWN', title: 'no sev',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('HIGH');
    createdReportIds.push(body.id);
  });

  it('TRAFFIC_DELAY without severity auto-fills to LOW', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'TRAFFIC_DELAY', title: 'no sev',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('LOW');
    createdReportIds.push(body.id);
  });

  it('PASSENGER_COMPLAINT without severity auto-fills to LOW', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'PASSENGER_COMPLAINT', title: 'no sev',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('LOW');
    createdReportIds.push(body.id);
  });

  it('driver can override — major accident CRITICAL instead of default HIGH', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'ACCIDENT', severity: 'CRITICAL', title: 'major accident',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('CRITICAL');
    createdReportIds.push(body.id);
  });

  it('driver can override — minor traffic delay MEDIUM instead of default LOW', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'INCIDENT', type: 'TRAFFIC_DELAY', severity: 'MEDIUM', title: 'significant delay',
    }, seed!.headers);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.severity).toBe('MEDIUM');
    createdReportIds.push(body.id);
  });

  it('severity is rejected on REQUEST (incident-only field)', async () => {
    const r = await makeRequest('POST', '/api/driver-app/reports', {
      kind: 'REQUEST', type: 'MAINTENANCE', severity: 'HIGH', title: 'wrong',
    }, seed!.headers);
    expect(r.status).toBe(400);
  });
});
