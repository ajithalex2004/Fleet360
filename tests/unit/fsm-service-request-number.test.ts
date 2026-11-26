import { describe, it, expect } from 'vitest';
import {
  formatServiceRequestNumber, customerCodeOf, isRequestChannel, isEntitlementType,
} from '@/lib/service-tickets/customer-context';

describe('FSM service request numbers (FSM-SR-<customer>-YYXXXX)', () => {
  it('formats the customer code, two-digit year and a zero-padded tenant sequence', () => {
    expect(formatServiceRequestNumber('C0012', 2026, 1)).toBe('FSM-SR-C0012-260001');
    expect(formatServiceRequestNumber('C0047', 2026, 2)).toBe('FSM-SR-C0047-260002');
    expect(formatServiceRequestNumber('C0012', 2027, 345)).toBe('FSM-SR-C0012-270345');
  });

  it('keeps counting past 9999 instead of truncating', () => {
    expect(formatServiceRequestNumber('C1', 2026, 12345)).toBe('FSM-SR-C1-2612345');
  });

  it('uses the customer code, cleaned, or falls back to part of the customer id', () => {
    expect(customerCodeOf({ id: 'x', customer_code: ' c-0012 ' })).toBe('C0012');
    expect(customerCodeOf({ id: '3f2a9c1e-77aa-4bcd-9e0f-112233445566', customer_code: null })).toBe('C3F2A9C');
  });

  it('accepts only the known channels and entitlement types', () => {
    expect(isRequestChannel('CUSTOMER_PORTAL')).toBe(true);
    expect(isRequestChannel('FAX')).toBe(false);
    expect(isEntitlementType('AMC')).toBe(true);
    expect(isEntitlementType('FREE')).toBe(false);
  });
});
