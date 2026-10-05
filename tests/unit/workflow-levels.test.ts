import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  conditionApplies, levelOutcome, parseDecisions, parseStepCondition, positiveHours,
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
