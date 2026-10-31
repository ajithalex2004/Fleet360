import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = {
  sql: [] as string[],
  driver: { exists: true, status: 'ACTIVE' as string | null },
  openPmWo: false,
  tripA: { exists: true, vehicleId: 'veh-1' as string | null, status: 'SCHEDULED' as string | null },
  tripBUpdatable: true,
};

vi.mock('@/lib/rls', () => ({
  withTenantRls: (_p: unknown, _t: string, fn: () => unknown) => fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      st.sql.push(sql.replace(/\s+/g, ' ').trim());
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      st.sql.push(q);
      if (q.startsWith('SELECT status FROM drivers')) return st.driver.exists ? [{ status: st.driver.status }] : [];
      if (q.includes('COUNT(*) AS count FROM fleet_work_orders')) return [{ count: 7n }];
      if (q.includes("requested_by = 'Preventive Maintenance Agent'")) return st.openPmWo ? [{ id: 'wo-old' }] : [];
      if (q.startsWith('INSERT INTO fleet_work_orders')) return [{ id: 'wo-new' }];
      if (q.startsWith('SELECT vehicle_id, status FROM trip_schedules')) {
        return st.tripA.exists ? [{ vehicle_id: st.tripA.vehicleId, status: st.tripA.status }] : [];
      }
      if (q.startsWith('UPDATE trip_schedules')) return st.tripBUpdatable ? [{ id: 'trip-b' }] : [];
      return [];
    }),
  },
}));

vi.mock('@/lib/agents/governance', () => ({ policyService: {} }));
vi.mock('@/lib/agents/governance/index', () => ({ policyService: {} }));

import { executeGatedAction, isGatedAction } from '@/lib/agents/governance/gated-actions';

const wrote = (needle: string) => st.sql.some((s) => s.includes(needle));
const VEHICLE_UUID = '3f1e2d4c-5b6a-4789-8abc-def012345678';
const inTwoDays = () => {
  const d = new Date(Date.now() + 2 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  st.sql.length = 0;
  st.driver = { exists: true, status: 'ACTIVE' };
  st.openPmWo = false;
  st.tripA = { exists: true, vehicleId: 'veh-1', status: 'SCHEDULED' };
  st.tripBUpdatable = true;
});

describe('approval executors', () => {
  it('registers the three new action types as executable', () => {
    for (const t of ['SUSPEND_DRIVER', 'SCHEDULE_PM_SLOT', 'LINK_TRIPS']) expect(isGatedAction(t)).toBe(true);
    for (const t of ['PUSH_TO_ERP', 'SPAWN_EXTRA_TRIP', 'AUDIT_INVOICE', 'COMMIT_MASTER_PLAN']) expect(isGatedAction(t)).toBe(false);
  });

  describe('SUSPEND_DRIVER', () => {
    const payload = { readiness: { driverId: 'drv-1', driverName: 'A' } };

    it('suspends an active driver', async () => {
      const r = await executeGatedAction('t1', 'SUSPEND_DRIVER', payload);
      expect(r).toEqual({ ok: true, detail: { driverId: 'drv-1', from: 'ACTIVE', to: 'SUSPENDED' } });
      expect(wrote("UPDATE drivers SET status = 'SUSPENDED'")).toBe(true);
    });

    it('is stale for a driver already suspended or gone, and changes nothing', async () => {
      st.driver.status = 'SUSPENDED';
      expect(await executeGatedAction('t1', 'SUSPEND_DRIVER', payload)).toMatchObject({ ok: false, stale: true });
      st.driver.exists = false;
      expect(await executeGatedAction('t1', 'SUSPEND_DRIVER', payload)).toMatchObject({ ok: false, stale: true });
      expect(wrote('UPDATE drivers')).toBe(false);
    });
  });

  describe('SCHEDULE_PM_SLOT', () => {
    const payload = () => ({
      vehicleId: VEHICLE_UUID,
      serviceThreshold: 'Oil change',
      slot: { slotDate: inTwoDays(), startTime: '13:00' },
    });

    it('creates a scheduled preventive work order at the slot, Dubai time', async () => {
      const p = payload();
      const r = await executeGatedAction('t1', 'SCHEDULE_PM_SLOT', p);
      expect(r).toMatchObject({ ok: true, detail: { workOrderId: 'wo-new', woNumber: 'FWO-000008' } });
      if (r.ok) expect(r.detail.scheduledDate).toBe(new Date(`${p.slot.slotDate}T13:00:00+04:00`).toISOString());
      expect(wrote('INSERT INTO fleet_work_orders')).toBe(true);
    });

    it('is stale when the vehicle already has an open preventive work order', async () => {
      st.openPmWo = true;
      expect(await executeGatedAction('t1', 'SCHEDULE_PM_SLOT', payload())).toMatchObject({ ok: false, stale: true });
      expect(wrote('INSERT INTO fleet_work_orders')).toBe(false);
    });

    it('is stale when the slot has passed, or the vehicle id cannot be stored', async () => {
      const past = { ...payload(), slot: { slotDate: '2020-01-01', startTime: '09:00' } };
      expect(await executeGatedAction('t1', 'SCHEDULE_PM_SLOT', past)).toMatchObject({ ok: false, stale: true });
      const legacyId = { ...payload(), vehicleId: 'VEH-LEGACY-7' };
      expect(await executeGatedAction('t1', 'SCHEDULE_PM_SLOT', legacyId)).toMatchObject({ ok: false, stale: true });
      expect(wrote('INSERT INTO fleet_work_orders')).toBe(false);
    });
  });

  describe('LINK_TRIPS', () => {
    const payload = { result: { tripAId: 'trip-a', tripBId: 'trip-b', vehicleId: 'veh-1', driverId: 'drv-9' } };

    it('puts trip B on trip A\'s vehicle while trip B is still unassigned', async () => {
      const r = await executeGatedAction('t1', 'LINK_TRIPS', payload);
      expect(r).toEqual({ ok: true, detail: { tripAId: 'trip-a', tripBId: 'trip-b', vehicleId: 'veh-1', driverId: 'drv-9' } });
      expect(wrote('UPDATE trip_schedules SET vehicle_id = $1')).toBe(true);
    });

    it('is stale when trip A moved to another vehicle or was cancelled', async () => {
      st.tripA.vehicleId = 'veh-2';
      expect(await executeGatedAction('t1', 'LINK_TRIPS', payload)).toMatchObject({ ok: false, stale: true });
      st.tripA = { exists: true, vehicleId: 'veh-1', status: 'CANCELLED' };
      expect(await executeGatedAction('t1', 'LINK_TRIPS', payload)).toMatchObject({ ok: false, stale: true });
      expect(wrote('UPDATE trip_schedules')).toBe(false);
    });

    it('is stale when trip B was resourced in the meantime', async () => {
      st.tripBUpdatable = false;
      expect(await executeGatedAction('t1', 'LINK_TRIPS', payload)).toMatchObject({ ok: false, stale: true });
    });
  });
});
