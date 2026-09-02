import { describe, it, expect } from 'vitest';

describe('Fleet360 Exchange: Server-Side Compliance Enforcement Gate (Phase 1.5)', () => {
  const validateAssignmentCompliance = (input: {
    partner: { operationalStatus: string };
    relationship?: { status: string };
    vehicle?: { isActive: boolean; mulkiyaExpiry: Date | null };
    driver?: { isActive: boolean; licenseExpiry: Date | null; permitExpiry: Date | null };
  }) => {
    // 1. Partner Status Gate
    if (input.partner.operationalStatus !== 'ACTIVE') {
      throw new Error(`Partner is not in ACTIVE operational status (current: ${input.partner.operationalStatus})`);
    }

    // 2. Tenant Relationship Gate
    if (input.relationship && input.relationship.status === 'BLOCKED') {
      throw new Error('Partner is blocked by this tenant');
    }

    // 3. Vehicle Gate
    if (input.vehicle) {
      if (!input.vehicle.isActive) throw new Error('Vehicle is inactive');
      if (input.vehicle.mulkiyaExpiry && input.vehicle.mulkiyaExpiry < new Date()) {
        throw new Error('Vehicle Mulkiya registration is expired');
      }
    }

    // 4. Driver Gate
    if (input.driver) {
      if (!input.driver.isActive) throw new Error('Driver is inactive');
      if (input.driver.licenseExpiry && input.driver.licenseExpiry < new Date()) {
        throw new Error('Driver driving license is expired');
      }
      if (input.driver.permitExpiry && input.driver.permitExpiry < new Date()) {
        throw new Error('Driver RTA permit is expired');
      }
    }

    return true;
  };

  it('EXCH-ASSIGN-001: rejects driver assignment if UAE license or RTA permit is expired', () => {
    // Expired Driving License
    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'ACTIVE' },
        driver: {
          isActive: true,
          licenseExpiry: new Date(Date.now() - 86400000), // Expired yesterday
          permitExpiry: new Date(Date.now() + 86400000),
        },
      })
    ).toThrow(/Driver driving license is expired/);

    // Expired RTA Permit
    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'ACTIVE' },
        driver: {
          isActive: true,
          licenseExpiry: new Date(Date.now() + 86400000),
          permitExpiry: new Date(Date.now() - 86400000), // Expired yesterday
        },
      })
    ).toThrow(/Driver RTA permit is expired/);
  });

  it('EXCH-ASSIGN-002: rejects vehicle assignment if Mulkiya registration is expired', () => {
    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'ACTIVE' },
        vehicle: {
          isActive: true,
          mulkiyaExpiry: new Date(Date.now() - 86400000), // Expired yesterday
        },
      })
    ).toThrow(/Vehicle Mulkiya registration is expired/);
  });

  it('EXCH-ASSIGN-003: rejects assignment if partner is BLOCKED by TenantPartnerRelationship', () => {
    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'ACTIVE' },
        relationship: { status: 'BLOCKED' },
      })
    ).toThrow(/Partner is blocked by this tenant/);
  });

  it('EXCH-COMPLY-001: rejects assignment if partner operationalStatus is SUSPENDED or BLACKLISTED', () => {
    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'SUSPENDED' },
      })
    ).toThrow(/Partner is not in ACTIVE operational status/);

    expect(() =>
      validateAssignmentCompliance({
        partner: { operationalStatus: 'BLACKLISTED' },
      })
    ).toThrow(/Partner is not in ACTIVE operational status/);
  });

  it('passes validation when all partner, vehicle, and driver documents are valid', () => {
    const valid = validateAssignmentCompliance({
      partner: { operationalStatus: 'ACTIVE' },
      relationship: { status: 'APPROVED' },
      vehicle: {
        isActive: true,
        mulkiyaExpiry: new Date(Date.now() + 180 * 86400000),
      },
      driver: {
        isActive: true,
        licenseExpiry: new Date(Date.now() + 365 * 86400000),
        permitExpiry: new Date(Date.now() + 180 * 86400000),
      },
    });

    expect(valid).toBe(true);
  });
});
