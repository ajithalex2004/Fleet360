import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  bookingRequestType, conditionApplies, levelOutcome, transferScope, parseDecisions, parseStepCondition, positiveHours,
} from '@/lib/workflow/levels';

const cond = (field: string, operator: string, value: string | number) => JSON.stringify({ field, operator, value });

describe('approval level conditions', () => {
  it('applies a level with no condition, or one that cannot be read', () => {
    expect(conditionApplies(null, { amount: 10 })).toBe(true);
    expect(conditionApplies('', { amount: 10 })).toBe(true);
    expect(conditionApplies('{not json', { amount: 10 })).toBe(true);
    expect(conditionApplies(cond('amount', 'BETWEEN', 5), { amount: 10 })).toBe(true);
    expect(parseStepCondition(cond('amount', 'GT', ''))).toBeNull();
  });

  it('sends small amounts through fewer levels than large ones', () => {
    const director = cond('amount', 'GTE', 10000);
    const cfo = cond('amount', 'GT', '50,000');
    expect(conditionApplies(director, { amount: 2500 })).toBe(false);
    expect(conditionApplies(director, { amount: 10000 })).toBe(true);
    expect(conditionApplies(cfo, { amount: 50000 })).toBe(false);
    expect(conditionApplies(cfo, { amount: '75000' })).toBe(true);
    expect(conditionApplies(cond('amount', 'LT', 1000), { amount: 999.99 })).toBe(true);
    expect(conditionApplies(cond('amount', 'LTE', 1000), { amount: 1000.01 })).toBe(false);
  });

  it('keeps a level when the approval has no value for its field', () => {
    expect(conditionApplies(cond('amount', 'GT', 10000), {})).toBe(true);
    expect(conditionApplies(cond('creditScore', 'LT', 600), { amount: 5 })).toBe(true);
  });

  it('treats amount and total value as the same field', () => {
    expect(conditionApplies(cond('totalValue', 'GT', 100), { amount: 50 })).toBe(false);
    expect(conditionApplies(cond('amount', 'GT', 100), { totalValue: 500 })).toBe(true);
  });

  it('applies a level to one booking service type, or to all but one', () => {
    const executiveOnly = cond('serviceType', 'EQ', 'EXECUTIVE');
    const notRental = cond('serviceType', 'NEQ', 'RENTAL');
    expect(conditionApplies(executiveOnly, { serviceType: 'EXECUTIVE', amount: 300 })).toBe(true);
    expect(conditionApplies(executiveOnly, { serviceType: 'RENTAL', amount: 300 })).toBe(false);
    expect(conditionApplies(notRental, { serviceType: 'RENTAL' })).toBe(false);
    expect(conditionApplies(notRental, { serviceType: 'STAFF_TRANSPORT' })).toBe(true);
    // A booking without a service type keeps the level.
    expect(conditionApplies(executiveOnly, { amount: 300 })).toBe(true);
  });

  it('applies a level to one request type', () => {
    const breakdown = cond('requestType', 'EQ', 'BREAKDOWN');
    expect(conditionApplies(breakdown, { requestType: 'BREAKDOWN', amount: 900 })).toBe(true);
    expect(conditionApplies(breakdown, { requestType: 'PREVENTIVE', amount: 900 })).toBe(false);
    const airport = cond('requestType', 'EQ', 'Airport Transfer (Arrival)');
    expect(conditionApplies(airport, { serviceType: 'EXECUTIVE', requestType: 'Airport Transfer (Arrival)' })).toBe(true);
    expect(conditionApplies(airport, { serviceType: 'EXECUTIVE', requestType: 'City Transfer' })).toBe(false);
    expect(conditionApplies(cond('requestType', 'NEQ', 'FUEL'), { requestType: 'TOLL' })).toBe(true);
    // A record without a request type keeps the level.
    expect(conditionApplies(breakdown, { amount: 900 })).toBe(true);
  });

  it('offers the request types the modules store', () => {
    const admin = readFileSync('src/app/(app)/admin/workflows/page.tsx', 'utf8');
    const portal = readFileSync('src/app/booking-portal/new/page.tsx', 'utf8');
    const block = admin.slice(admin.indexOf("'BOOKING.BOOKING_APPROVAL': {"), admin.indexOf('const requestTypeFor'));
    const values = [...block.matchAll(/opts\(\[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]));
    expect(values.length).toBe(18);
    for (const v of values) expect(portal).toContain(`'${v}'`);
    const amendments = readFileSync('src/app/leasing/amendments/page.tsx', 'utf8');
    for (const v of ['MILEAGE_UPGRADE', 'VEHICLE_SWAP', 'TERM_EXTENSION', 'RATE_CHANGE', 'ADDITIONAL_SERVICE']) expect(amendments).toContain(v);
    const subjects = readFileSync('src/lib/workflow/subjects.ts', 'utf8');
    expect(subjects).toMatch(/requestType: mr\.maintenanceType/);
    expect(subjects).toMatch(/requestType: r\.category/);
    expect(subjects).toMatch(/requestType: r\.amendment_type/);
    expect(subjects).toMatch(/requestType: bookingRequestType\(b\.serviceType, notes\)/);
  });

  it("reads a booking's request type from its own service's field, else its service type", () => {
    expect(bookingRequestType('EXECUTIVE', { tripType: 'Multi-Day' })).toBe('Multi-Day');
    expect(bookingRequestType('STAFF_TRANSPORT', { shiftType: 'Split Shift' })).toBe('Split Shift');
    expect(bookingRequestType('LOGISTICS', { shipmentType: 'FTL – Full Truck Load' })).toBe('FTL – Full Truck Load');
    // A field left over from another service is not this booking's type.
    expect(bookingRequestType('LOGISTICS', { tripType: 'Multi-Day', shipmentType: 'LCL – Less than Container Load' }))
      .toBe('LCL – Less than Container Load');
    expect(bookingRequestType('EXECUTIVE', { shiftType: 'Split Shift' })).toBe('EXECUTIVE');
    expect(bookingRequestType('STAFF_TRANSPORT', { shiftType: '  ' })).toBe('STAFF_TRANSPORT');
    expect(bookingRequestType('RENTAL', { tripType: 'Full Day' })).toBe('RENTAL');
    expect(bookingRequestType(null, {})).toBeUndefined();
  });

  it('skips trip-type levels for a booking without a trip type', () => {
    const multiDay = cond('requestType', 'EQ', 'Multi-Day');
    expect(conditionApplies(multiDay, { serviceType: 'RENTAL', requestType: bookingRequestType('RENTAL', {}) })).toBe(false);
    expect(conditionApplies(multiDay, { requestType: bookingRequestType('STAFF_TRANSPORT', {}) })).toBe(false);
    expect(conditionApplies(multiDay, { requestType: bookingRequestType('EXECUTIVE', { tripType: 'Multi-Day' }) })).toBe(true);
  });

  it('tells a transfer within one emirate from one between emirates', () => {
    expect(transferScope('DUBAI', 'dubai')).toBe('SAME_EMIRATE');
    expect(transferScope('DUBAI', 'ABU_DHABI')).toBe('CROSS_EMIRATE');
    expect(transferScope('DUBAI', null)).toBeUndefined();
    expect(transferScope('', 'SHARJAH')).toBeUndefined();
    const crossOnly = cond('emirateScope', 'EQ', 'CROSS_EMIRATE');
    expect(conditionApplies(crossOnly, { emirateScope: transferScope('DUBAI', 'FUJAIRAH') })).toBe(true);
    expect(conditionApplies(crossOnly, { emirateScope: transferScope('DUBAI', 'DUBAI') })).toBe(false);
  });

  it('applies a level to transfers from or to one branch or emirate', () => {
    expect(conditionApplies(cond('toBranch', 'EQ', 'Dubai Airport'), { toBranch: ' dubai airport ' })).toBe(true);
    expect(conditionApplies(cond('toBranch', 'EQ', 'Dubai Airport'), { toBranch: 'Deira' })).toBe(false);
    expect(conditionApplies(cond('fromEmirate', 'NEQ', 'DUBAI'), { fromEmirate: 'SHARJAH' })).toBe(true);
    expect(conditionApplies(cond('toEmirate', 'EQ', 'ABU_DHABI'), { toEmirate: 'DUBAI' })).toBe(false);
  });

  it('offers the emirates vehicle transfers store', () => {
    const admin = readFileSync('src/app/(app)/admin/workflows/page.tsx', 'utf8');
    const transfers = readFileSync('src/app/(app)/rental/transfers/page.tsx', 'utf8');
    const line = admin.split('\n').find((l) => l.startsWith('const EMIRATE_CHOICES')) ?? '';
    const codes = [...line.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes).toHaveLength(7);
    for (const c of codes) expect(transfers).toContain(`value: '${c}'`);
    const subjects = readFileSync('src/lib/workflow/subjects.ts', 'utf8');
    expect(subjects).toMatch(/emirateScope: transferScope\(r\.from_emirate, r\.to_emirate\)/);
  });

  it('applies a level to long or high-rate rental renewals', () => {
    const longExtension = cond('extensionDays', 'GT', 30);
    expect(conditionApplies(longExtension, { extensionDays: 45, amount: 9000 })).toBe(true);
    expect(conditionApplies(longExtension, { extensionDays: 7, amount: 1400 })).toBe(false);
    expect(conditionApplies(cond('dailyRate', 'LT', 150), { dailyRate: 120 })).toBe(true);
    expect(conditionApplies(cond('depositTopUp', 'GT', 0), { depositTopUp: 0 })).toBe(false);
    const subjects = readFileSync('src/lib/workflow/subjects.ts', 'utf8');
    expect(subjects).toMatch(/dailyRate: num\(r\.daily_rate\), depositTopUp: num\(r\.deposit_top_up\)/);
  });

  it('applies a level to payables from one module, source or vendor', () => {
    expect(conditionApplies(cond('sourceModule', 'EQ', 'MAINTENANCE'), { sourceModule: 'MAINTENANCE', amount: 500 })).toBe(true);
    expect(conditionApplies(cond('sourceModule', 'EQ', 'MAINTENANCE'), { sourceModule: 'GENERAL', amount: 500 })).toBe(false);
    expect(conditionApplies(cond('vendor', 'EQ', 'Al Futtaim Motors'), { vendor: 'al futtaim motors' })).toBe(true);
    const subjects = readFileSync('src/lib/workflow/subjects.ts', 'utf8');
    expect(subjects).toMatch(/sourceType: r\.source_type, costCentre: r\.cost_centre/);
    const admin = readFileSync('src/app/(app)/admin/workflows/page.tsx', 'utf8');
    for (const f of ['sourceModule', 'sourceType', 'vendor', 'costCentre']) expect(admin).toContain(`value: '${f}'`);
  });

  it('applies a level to journal entries from one source', () => {
    const manualOnly = cond('sourceType', 'EQ', 'MANUAL');
    expect(conditionApplies(manualOnly, { sourceType: 'MANUAL', amount: 1200 })).toBe(true);
    expect(conditionApplies(manualOnly, { sourceType: 'AP_PAYABLE', amount: 1200 })).toBe(false);
    const admin = readFileSync('src/app/(app)/admin/workflows/page.tsx', 'utf8');
    const block = admin.slice(admin.indexOf("'FINANCE.JOURNAL_APPROVAL': ["), admin.indexOf("'RAC.RENEWAL_APPROVAL': ["));
    expect(block).toContain("value: 'MANUAL'");
  });

  it('posts a journal entry only once it is approved, and can return a submitted one', () => {
    const route = readFileSync('src/app/api/finance/journal-entries/[id]/route.ts', 'utf8');
    expect(route).toMatch(/case 'post':[\s\S]*?if \(current\.status !== 'APPROVED'\)/);
    expect(route).toMatch(/case 'reject':/);
  });

  it("applies a level to lease quotations by lease type, margin and the customer's credit", () => {
    const c = { amount: 420000, leaseType: 'LONG_TERM', markupPct: 6.5, customerType: 'corporate', creditScore: 610, riskRating: 'HIGH' };
    expect(conditionApplies(cond('riskRating', 'EQ', 'HIGH'), c)).toBe(true);
    expect(conditionApplies(cond('creditScore', 'LT', 650), c)).toBe(true);
    expect(conditionApplies(cond('customerType', 'EQ', 'CORPORATE'), c)).toBe(true);
    expect(conditionApplies(cond('markupPct', 'LT', 5), c)).toBe(false);
    expect(conditionApplies(cond('leaseType', 'EQ', 'SHORT_TERM'), c)).toBe(false);
    const subjects = readFileSync('src/lib/workflow/subjects.ts', 'utf8');
    expect(subjects).toMatch(/creditScore: credit\?\.creditScore \?\? undefined, riskRating: credit\?\.riskRating/);
    const admin = readFileSync('src/app/(app)/admin/workflows/page.tsx', 'utf8');
    for (const p of ['QUOTATION_APPROVAL', 'CREDIT_APPROVAL', 'PO_REQUEST']) expect(admin).toContain(`'LEASING.${p}':`);
  });

  it('compares text for equality, case-insensitively', () => {
    expect(conditionApplies(cond('category', 'EQ', 'Fuel'), { category: 'FUEL' })).toBe(true);
    expect(conditionApplies(cond('category', 'NEQ', 'Fuel'), { category: 'fuel' })).toBe(false);
    expect(conditionApplies(cond('category', 'GT', 'Fuel'), { category: 'Tyres' })).toBe(true);
  });
});

describe('approval level outcome', () => {
  const approve = (email: string, override = false) => ({ email, action: 'APPROVE' as const, ...(override ? { override } : {}) });
  const reject = (email: string) => ({ email, action: 'REJECT' as const });
  const approvers = ['a@x.co', 'b@x.co', 'c@x.co'];

  it('lets any one approver decide a level that does not require all', () => {
    expect(levelOutcome({ requireAll: false, approverEmails: approvers, decisions: [] }).status).toBe('PENDING');
    expect(levelOutcome({ requireAll: false, approverEmails: approvers, decisions: [approve('b@x.co')] })).toEqual({ status: 'APPROVED' });
  });

  it('waits for every approver on a level that requires all', () => {
    const one = levelOutcome({ requireAll: true, approverEmails: approvers, decisions: [approve('a@x.co')] });
    expect(one).toEqual({ status: 'PENDING', waitingFor: ['b@x.co', 'c@x.co'] });
    const all = levelOutcome({
      requireAll: true, approverEmails: ['A@x.co', 'b@x.co', 'c@x.co'],
      decisions: [approve('a@x.co'), approve('C@X.CO'), approve('b@x.co')].map((d) => ({ ...d, email: d.email.toLowerCase() })),
    });
    expect(all).toEqual({ status: 'APPROVED' });
  });

  it('rejects on any rejection, even after others approved', () => {
    expect(levelOutcome({ requireAll: true, approverEmails: approvers, decisions: [approve('a@x.co'), reject('b@x.co')] }))
      .toEqual({ status: 'REJECTED' });
  });

  it("settles a level on a tenant administrator's decision", () => {
    expect(levelOutcome({ requireAll: true, approverEmails: approvers, decisions: [approve('admin@x.co', true)] }))
      .toEqual({ status: 'APPROVED' });
  });

  it('counts only listed approvers on an all-approvers level', () => {
    expect(levelOutcome({ requireAll: true, approverEmails: ['a@x.co'], decisions: [approve('z@x.co')] }))
      .toEqual({ status: 'PENDING', waitingFor: ['a@x.co'] });
  });

  it('lets the first approval decide when no approvers were resolved', () => {
    expect(levelOutcome({ requireAll: true, approverEmails: [], decisions: [approve('admin@x.co')] })).toEqual({ status: 'APPROVED' });
  });

  it('reads stored decisions defensively', () => {
    expect(parseDecisions('[{"email":"A@X.co","action":"APPROVE"},{"email":1},{"action":"APPROVE"},null]'))
      .toEqual([{ email: 'a@x.co', action: 'APPROVE' }]);
    expect(parseDecisions('nope')).toEqual([]);
    expect(parseDecisions(undefined)).toEqual([]);
  });

  it('uses the fallback for missing or non-positive hours', () => {
    expect(positiveHours(24, 48)).toBe(24);
    expect(positiveHours(0, 48)).toBe(48);
    expect(positiveHours(null, 48)).toBe(48);
    expect(positiveHours('12', 48)).toBe(12);
  });
});

describe('approval context comes from the server', () => {
  it('the trigger API never passes the request body as the approval context', () => {
    const src = readFileSync('src/app/api/workflow/trigger/route.ts', 'utf8');
    expect(src).not.toMatch(/contextData,\s*\n/);
    expect(src).toMatch(/contextData: loaded\?\.context \?\? \{\}/);
  });
});
