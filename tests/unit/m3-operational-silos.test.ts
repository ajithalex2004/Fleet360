/**
 * tests/unit/m3-operational-silos.test.ts
 *
 * Verification suite for Milestone M3 (Features F23 - F31):
 * - F24: Grounded Vehicle Safety Enforcement (VEHICLE_UNASSIGNABLE_STATUSES and isActive)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVehicleFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vehicle: {
      findFirst: (...args: unknown[]) => mockVehicleFindFirst(...args),
    },
    tripSchedule: { findFirst: vi.fn().mockResolvedValue(null) },
    schoolBusTrip: { findFirst: vi.fn().mockResolvedValue(null) },
    logisticsShipmentOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    leaseContractV2: { findFirst: vi.fn().mockResolvedValue(null) },
    rentalAgreement: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import {
  VEHICLE_UNASSIGNABLE_STATUSES,
  checkVehicleAssignable,
} from '@/lib/fleet/vehicle-availability';

describe('M3 - F24: Grounded Vehicle Safety Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes GROUNDED in VEHICLE_UNASSIGNABLE_STATUSES', () => {
    expect(VEHICLE_UNASSIGNABLE_STATUSES).toContain('GROUNDED');
  });

  it('rejects vehicle assignment when status is GROUNDED', async () => {
    mockVehicleFindFirst.mockResolvedValueOnce({
      id: 'v-grounded-1',
      tenantId: 'tenant-1',
      status: 'GROUNDED',
      licensePlate: 'DXB-101',
      isActive: true,
      deletedAt: null,
    });

    const res = await checkVehicleAssignable('v-grounded-1', {
      tenantId: 'tenant-1',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.assignable).toBe(false);
      expect(res.reason).toBe('Vehicle is grounded');
    }
  });

  it('rejects vehicle assignment when isActive is false regardless of status', async () => {
    mockVehicleFindFirst.mockResolvedValueOnce({
      id: 'v-inactive-1',
      tenantId: 'tenant-1',
      status: 'AVAILABLE',
      licensePlate: 'DXB-102',
      isActive: false,
      deletedAt: null,
    });

    const res = await checkVehicleAssignable('v-inactive-1', {
      tenantId: 'tenant-1',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.assignable).toBe(false);
      expect(res.reason).toBe('Vehicle is inactive');
    }
  });

  it('allows vehicle assignment when status is AVAILABLE and isActive is true', async () => {
    mockVehicleFindFirst.mockResolvedValueOnce({
      id: 'v-avail-1',
      tenantId: 'tenant-1',
      status: 'AVAILABLE',
      licensePlate: 'DXB-103',
      isActive: true,
      deletedAt: null,
    });

    const res = await checkVehicleAssignable('v-avail-1', {
      tenantId: 'tenant-1',
    });

    expect(res.ok).toBe(true);
    expect(res.assignable).toBe(true);
  });
});
