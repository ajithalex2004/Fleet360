import { describe, it, expect } from 'vitest';
import {
  FACILITIES_CATALOGUE,
  facilitiesCategoryKeys,
  facilitiesDefaultSlaRule,
  facilitiesTypeKeys,
} from '@/lib/service-config/facilities-template';
import {
  filterAllowedFsmTypes,
  isFsmTypeAllowedForCustomer,
  parseFsmRequestTypes,
} from '@/lib/customer-portal/fsm-types';

describe('FSM Facilities SLA Seeding & Per-Customer Request Type Scoping', () => {
  it('derives positive response, on-site arrival, and resolution SLAs for all 16 FM_* types', () => {
    expect(facilitiesCategoryKeys()).toHaveLength(4);
    expect(facilitiesTypeKeys()).toHaveLength(16);

    for (const cat of FACILITIES_CATALOGUE) {
      for (const t of cat.types) {
        const sla = facilitiesDefaultSlaRule(t.defaultPriority, t.sla);
        expect(typeof sla.onSiteArrivalHours).toBe('number');
        expect(sla.onSiteArrivalHours!).toBeGreaterThan(0);
        expect(sla.responseSlaMinutes).toBeGreaterThanOrEqual(15);
        expect(sla.resolutionSlaHours).toBe(t.sla[t.defaultPriority]);
        expect(sla.onSiteArrivalHours!).toBeLessThanOrEqual(sla.resolutionSlaHours!);
      }
    }
  });

  it('validates and deduplicates per-customer FSM request type keys cleanly', () => {
    expect(parseFsmRequestTypes([])).toEqual([]);
    expect(parseFsmRequestTypes(['FSM_EMERG_OUTAGE', 'FSM_REACT_BREAK_FIX', 'FSM_EMERG_OUTAGE'])).toEqual([
      'FSM_EMERG_OUTAGE',
      'FSM_REACT_BREAK_FIX',
    ]);
    expect(parseFsmRequestTypes(['FM_HVAC', 'FM_PLUMBING'])).toEqual(['FM_HVAC', 'FM_PLUMBING']);

    // Rejects invalid shapes and keys
    expect(parseFsmRequestTypes('FSM_EMERG_OUTAGE')).toBeNull();
    expect(parseFsmRequestTypes([''])).toBeNull();
    expect(parseFsmRequestTypes(['lowercase_bad'])).toBeNull();
    expect(parseFsmRequestTypes(['FSM BAD KEY'])).toBeNull();
    expect(parseFsmRequestTypes([123])).toBeNull();
  });

  it('keeps empty/null customer whitelist unrestricted and enforces non-empty whitelist strictly', () => {
    const tenantEligible: Array<[string, { name: string }]> = [
      ['FSM_EMERG_OUTAGE', { name: 'Critical Outage' }],
      ['FSM_REACT_BREAK_FIX', { name: 'Break/Fix Repair' }],
      ['FM_HVAC', { name: 'Air conditioning / HVAC' }],
    ];

    // Backward compatible: empty / null / undefined => all tenant-enabled FSM types
    expect(filterAllowedFsmTypes(tenantEligible, [])).toHaveLength(3);
    expect(filterAllowedFsmTypes(tenantEligible, null)).toHaveLength(3);
    expect(filterAllowedFsmTypes(tenantEligible, undefined)).toHaveLength(3);
    expect(isFsmTypeAllowedForCustomer('FM_HVAC', [])).toBe(true);
    expect(isFsmTypeAllowedForCustomer('FM_HVAC', null)).toBe(true);

    // Explicit customer whitelist restricts strictly & intersects with tenant-enabled types
    const customerList = ['FSM_EMERG_OUTAGE', 'FSM_DISABLED_AT_TENANT'];
    const scoped = filterAllowedFsmTypes(tenantEligible, customerList);
    expect(scoped.map(([k]) => k)).toEqual(['FSM_EMERG_OUTAGE']);

    expect(isFsmTypeAllowedForCustomer('FSM_EMERG_OUTAGE', customerList)).toBe(true);
    expect(isFsmTypeAllowedForCustomer('FSM_REACT_BREAK_FIX', customerList)).toBe(false);
    expect(isFsmTypeAllowedForCustomer('FM_HVAC', customerList)).toBe(false);
  });
});
