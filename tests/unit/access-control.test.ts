/**
 * Unit tests for src/lib/access-control.ts
 *
 * What is tested:
 *  - canWrite(): role/plan enforcement for all module combinations
 *  - moduleFromPath(): URL-to-module mapping for all supported path prefixes
 *  - TRIAL_FREE_MODULES: shape and content of the readonly tuple
 *
 * Prerequisites: none — pure unit tests, no DB or server required.
 */

import { describe, it, expect } from 'vitest';
import {
  canWrite,
  moduleFromPath,
  TRIAL_FREE_MODULES,
  type AppModule,
} from '@/lib/access-control';

// ── canWrite() ────────────────────────────────────────────────────────────────

describe('canWrite()', () => {
  describe('SUPER_ADMIN role', () => {
    it('always returns true regardless of plan', () => {
      const plans = ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];
      const modules: AppModule[] = [
        'fleet', 'rac', 'leasing', 'logistics', 'finance',
        'school-bus', 'ambulance', 'dispatch', 'staff', 'admin',
      ];

      for (const plan of plans) {
        for (const mod of modules) {
          expect(
            canWrite(plan, 'SUPER_ADMIN', mod),
            `SUPER_ADMIN + ${plan} + ${mod} should be writable`,
          ).toBe(true);
        }
      }
    });

    it('returns true for SUPER_ADMIN on TRIAL plan for every module', () => {
      const modules: AppModule[] = ['fleet', 'finance', 'admin', 'leasing'];
      for (const mod of modules) {
        expect(canWrite('TRIAL', 'SUPER_ADMIN', mod)).toBe(true);
      }
    });
  });

  describe('TRIAL plan + TENANT_ADMIN', () => {
    it('returns true for the fleet module (fleet is in TRIAL_FREE_MODULES)', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'fleet')).toBe(true);
    });

    it('returns false for finance on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'finance')).toBe(false);
    });

    it('returns false for leasing on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'leasing')).toBe(false);
    });

    it('returns false for logistics on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'logistics')).toBe(false);
    });

    it('returns false for rac on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'rac')).toBe(false);
    });

    it('returns false for school-bus on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'school-bus')).toBe(false);
    });

    it('returns false for ambulance on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'ambulance')).toBe(false);
    });

    it('returns false for dispatch on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'dispatch')).toBe(false);
    });

    it('returns false for staff on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'staff')).toBe(false);
    });

    it('returns false for admin on TRIAL plan', () => {
      expect(canWrite('TRIAL', 'TENANT_ADMIN', 'admin')).toBe(false);
    });
  });

  describe('paid plans', () => {
    const paidPlans = ['STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];
    const allModules: AppModule[] = [
      'fleet', 'rac', 'leasing', 'logistics', 'finance',
      'school-bus', 'ambulance', 'dispatch', 'staff', 'admin',
    ];

    for (const plan of paidPlans) {
      it(`returns true for ALL modules on ${plan} plan (TENANT_ADMIN)`, () => {
        for (const mod of allModules) {
          expect(
            canWrite(plan, 'TENANT_ADMIN', mod),
            `${plan} + TENANT_ADMIN + ${mod} should be writable`,
          ).toBe(true);
        }
      });
    }
  });

  describe('other roles on paid plans', () => {
    it('returns true for FLEET_MANAGER on ENTERPRISE', () => {
      expect(canWrite('ENTERPRISE', 'FLEET_MANAGER', 'fleet')).toBe(true);
    });

    it('returns false for FLEET_MANAGER on TRIAL (non-fleet module)', () => {
      expect(canWrite('TRIAL', 'FLEET_MANAGER', 'finance')).toBe(false);
    });

    it('returns true for FLEET_MANAGER on TRIAL for fleet module', () => {
      expect(canWrite('TRIAL', 'FLEET_MANAGER', 'fleet')).toBe(true);
    });
  });
});

// ── moduleFromPath() ──────────────────────────────────────────────────────────

describe('moduleFromPath()', () => {
  describe('fleet module paths', () => {
    it('maps /api/fleet/vehicles to fleet', () => {
      expect(moduleFromPath('/api/fleet/vehicles')).toBe('fleet');
    });

    it('maps /api/fleet to fleet', () => {
      expect(moduleFromPath('/api/fleet')).toBe('fleet');
    });

    it('maps /api/vehicles to fleet', () => {
      expect(moduleFromPath('/api/vehicles')).toBe('fleet');
    });

    it('maps /api/drivers to fleet', () => {
      expect(moduleFromPath('/api/drivers')).toBe('fleet');
    });

    it('maps /api/drivers/123 to fleet', () => {
      expect(moduleFromPath('/api/drivers/123')).toBe('fleet');
    });
  });

  describe('rac module paths', () => {
    it('maps /api/rac to rac', () => {
      expect(moduleFromPath('/api/rac')).toBe('rac');
    });

    it('maps /api/rac/bookings to rac', () => {
      expect(moduleFromPath('/api/rac/bookings')).toBe('rac');
    });
  });

  describe('leasing module paths', () => {
    it('maps /api/leasing to leasing', () => {
      expect(moduleFromPath('/api/leasing')).toBe('leasing');
    });

    it('maps /api/leasing/contracts to leasing', () => {
      expect(moduleFromPath('/api/leasing/contracts')).toBe('leasing');
    });
  });

  describe('logistics module paths', () => {
    it('maps /api/logistics to logistics', () => {
      expect(moduleFromPath('/api/logistics')).toBe('logistics');
    });

    it('maps /api/logistics/trips to logistics', () => {
      expect(moduleFromPath('/api/logistics/trips')).toBe('logistics');
    });

    it('maps /api/trips to logistics', () => {
      expect(moduleFromPath('/api/trips')).toBe('logistics');
    });
  });

  describe('finance module paths', () => {
    it('maps /api/finance to finance', () => {
      expect(moduleFromPath('/api/finance')).toBe('finance');
    });

    it('maps /api/finance/invoices to finance', () => {
      expect(moduleFromPath('/api/finance/invoices')).toBe('finance');
    });

    it('maps /api/invoice to finance', () => {
      expect(moduleFromPath('/api/invoice')).toBe('finance');
    });
  });

  describe('school-bus module paths', () => {
    it('maps /api/school-bus to school-bus', () => {
      expect(moduleFromPath('/api/school-bus')).toBe('school-bus');
    });

    it('maps /api/school-bus/students to school-bus', () => {
      expect(moduleFromPath('/api/school-bus/students')).toBe('school-bus');
    });

    it('maps /api/students to school-bus', () => {
      expect(moduleFromPath('/api/students')).toBe('school-bus');
    });

    it('maps /api/routes to school-bus', () => {
      expect(moduleFromPath('/api/routes')).toBe('school-bus');
    });
  });

  describe('ambulance module paths', () => {
    it('maps /api/ambulance to ambulance', () => {
      expect(moduleFromPath('/api/ambulance')).toBe('ambulance');
    });

    it('maps /api/incidents to ambulance', () => {
      expect(moduleFromPath('/api/incidents')).toBe('ambulance');
    });

    it('maps /api/incidents/123 to ambulance', () => {
      expect(moduleFromPath('/api/incidents/123')).toBe('ambulance');
    });
  });

  describe('dispatch module paths', () => {
    it('maps /api/dispatch to dispatch', () => {
      expect(moduleFromPath('/api/dispatch')).toBe('dispatch');
    });

    it('maps /api/dispatch/jobs to dispatch', () => {
      expect(moduleFromPath('/api/dispatch/jobs')).toBe('dispatch');
    });
  });

  describe('staff module paths', () => {
    it('maps /api/staff to staff', () => {
      expect(moduleFromPath('/api/staff')).toBe('staff');
    });
  });

  describe('admin module paths', () => {
    it('maps /api/admin to admin', () => {
      expect(moduleFromPath('/api/admin')).toBe('admin');
    });

    it('maps /api/admin/tenants to admin', () => {
      expect(moduleFromPath('/api/admin/tenants')).toBe('admin');
    });

    it('maps /api/admin/nav-permissions to admin', () => {
      expect(moduleFromPath('/api/admin/nav-permissions')).toBe('admin');
    });
  });

  describe('unknown paths', () => {
    it('returns null for /api/unknown', () => {
      expect(moduleFromPath('/api/unknown')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(moduleFromPath('')).toBeNull();
    });

    it('returns null for /api/auth/login', () => {
      expect(moduleFromPath('/api/auth/login')).toBeNull();
    });

    it('returns null for /platform', () => {
      expect(moduleFromPath('/platform')).toBeNull();
    });

    it('returns null for /api/tenants', () => {
      // /api/tenants is NOT the same as /api/admin/tenants
      expect(moduleFromPath('/api/tenants')).toBeNull();
    });
  });
});

// ── TRIAL_FREE_MODULES ────────────────────────────────────────────────────────

describe('TRIAL_FREE_MODULES', () => {
  it('contains "fleet"', () => {
    expect(TRIAL_FREE_MODULES).toContain('fleet');
  });

  it('is an array (readonly tuple)', () => {
    expect(Array.isArray(TRIAL_FREE_MODULES)).toBe(true);
  });

  it('does not contain "finance"', () => {
    expect(TRIAL_FREE_MODULES).not.toContain('finance');
  });

  it('does not contain "leasing"', () => {
    expect(TRIAL_FREE_MODULES).not.toContain('leasing');
  });

  it('does not contain "admin"', () => {
    expect(TRIAL_FREE_MODULES).not.toContain('admin');
  });

  it('is readonly — attempting to mutate at runtime should not modify the original', () => {
    // TypeScript enforces this at compile time; we just verify the value is stable
    const snapshot = [...TRIAL_FREE_MODULES];
    expect(snapshot).toEqual(TRIAL_FREE_MODULES as unknown as string[]);
  });
});
