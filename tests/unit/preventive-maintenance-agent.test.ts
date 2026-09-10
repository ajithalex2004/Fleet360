import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateVehicleBurnDown,
  VehiclePMInput,
} from '@/lib/agents/preventive-maintenance/forecaster';
import {
  recommendLowestImpactSlot,
  SlotOptimizationInput,
} from '@/lib/agents/preventive-maintenance/slot-optimizer';
import {
  getNextOEMMilestone,
  STANDARD_OEM_MILESTONES,
} from '@/lib/agents/preventive-maintenance/oem-schedules';
import { PREVENTIVE_MAINTENANCE_AGENT } from '@/lib/agents/preventive-maintenance/agent';
import { POST as runPOST } from '@/app/api/agents/preventive-maintenance/run/route';
import { GET as forecastsGET } from '@/app/api/agents/preventive-maintenance/forecasts/route';
import { POST as bookSlotPOST } from '@/app/api/agents/preventive-maintenance/book-slot/route';

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn().mockImplementation((_prisma: any, _tenantId: string, fn: any) => fn(_prisma)),
}));

describe('Preventive Maintenance Agent: Continuous Burn-Down & Smart Slot Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dimension 1: OEM Schedule Milestones & Next Target Calculation', () => {
    it('identifies next milestone for 18,200 km as 20,000 km Intermediate Service', () => {
      const result = getNextOEMMilestone(18_200);
      expect(result.targetOdometerKm).toBe(20_000);
      expect(result.remainingKm).toBe(1_800);
      expect(result.nextMilestone.tier).toBe('INTERMEDIATE');
      expect(result.nextMilestone.label).toContain('20,000 km Service');
    });

    it('identifies next milestone for high-mileage vehicle (114,000 km) as 120,000 km Major Service', () => {
      const result = getNextOEMMilestone(114_000);
      expect(result.targetOdometerKm).toBe(120_000);
      expect(result.remainingKm).toBe(6_000);
      expect(result.nextMilestone.tier).toBe('MAJOR');
    });
  });

  describe('Dimension 2: Continuous Burn-Down Forecaster & Narrative Generation', () => {
    it('accurately computes: "Vehicle V-103 will reach its 20,000 km service threshold in approximately 6 operating days"', () => {
      // Vehicle V-103 currently at 18,800 km, burning 200 km/day
      // Target: 20,000 km (remaining: 1,200 km)
      // Days to due: 1,200 / 200 = 6 days
      const mockVehicle: VehiclePMInput = {
        vehicleId: '00000000-0000-0000-0000-000000000103',
        vehicleCode: 'Vehicle V-103',
        licensePlate: 'Dubai B 78219',
        make: 'Toyota',
        model: 'HiAce Commuter',
        currentOdometerKm: 18_800,
        historicalDailyKm: 200,
        lastServiceOdometerKm: 10_000,
      };

      const forecast = calculateVehicleBurnDown(mockVehicle, new Date('2026-09-09T00:00:00.000Z'));

      expect(forecast.vehicleCode).toBe('Vehicle V-103');
      expect(forecast.targetValue).toBe(20_000);
      expect(forecast.remainingKm).toBe(1_200);
      expect(forecast.dailyAvgKm).toBe(200);
      expect(forecast.estimatedDaysToDue).toBe(6);
      expect(forecast.projectedDueDate).toBe('2026-09-15');
      expect(forecast.urgencyLevel).toBe('DUE_SOON');
      expect(forecast.forecastNarrative).toContain(
        'Vehicle V-103 will reach its 20,000 km Service (Intermediate) threshold in approximately 6 operating days (projected: 2026-09-15)'
      );
    });

    it('flags OVERDUE when current odometer exceeds target threshold', () => {
      const mockVehicle: VehiclePMInput = {
        vehicleId: '00000000-0000-0000-0000-000000000999',
        vehicleCode: 'V-999',
        licensePlate: 'Abu Dhabi 4 19283',
        make: 'Toyota',
        model: 'Coaster',
        currentOdometerKm: 20_150,
        historicalDailyKm: 150,
        activePlan: {
          planId: 'p-1',
          planName: 'Quarterly Commercial Plan',
          triggers: [{ triggerType: 'ODOMETER', intervalValue: 20_000, intervalUnit: 'KM' }],
        },
      };

      const forecast = calculateVehicleBurnDown(mockVehicle, new Date('2026-09-09T00:00:00.000Z'));
      expect(forecast.estimatedDaysToDue).toBe(0);
      expect(forecast.urgencyLevel).toBe('OVERDUE');
      expect(forecast.forecastNarrative).toContain('has reached its');
    });
  });

  describe('Dimension 3: Lowest Operational Impact Slot Recommender', () => {
    it('recommends slot with zero route overlap and minimum passenger disruption', () => {
      const mockTrips = [
        {
          tripId: 'TRIP-1',
          tripNumber: 'DXB-MORN-01',
          departureTime: '2026-09-15T06:30:00.000Z',
          arrivalTime: '2026-09-15T08:30:00.000Z',
          passengerCount: 28,
        },
        {
          tripId: 'TRIP-2',
          tripNumber: 'DXB-EVE-02',
          departureTime: '2026-09-15T18:00:00.000Z',
          arrivalTime: '2026-09-15T20:00:00.000Z',
          passengerCount: 30,
        },
      ];

      const input: SlotOptimizationInput = {
        vehicleId: '00000000-0000-0000-0000-000000000103',
        vehicleCode: 'V-103',
        projectedDueDate: '2026-09-15',
        estimatedDurationHours: 3.0,
        upcomingTrips: mockTrips,
      };

      const slot = recommendLowestImpactSlot(input, new Date('2026-09-09T00:00:00.000Z'));

      expect(slot.slotDate).toBeDefined();
      expect(slot.startTime).toBeDefined();
      expect(slot.endTime).toBeDefined();
      // Should pick midday gap (13:00-16:30) or weekend, avoiding 06:30 and 18:00 peak shifts
      expect(slot.disruptedTripsCount).toBe(0);
      expect(slot.disruptedPassengersCount).toBe(0);
      expect(slot.operationalDisruptionScore).toBeLessThan(50);
    });
  });

  describe('Dimension 4: Preventive Maintenance Agent Full Execution', () => {
    it('runs scan, stores forecast, and stages approval for vehicle reaching threshold', async () => {
      const mockVehicles = [
        {
          id: '11111111-1111-1111-1111-111111111103',
          vehicle_code: 'Vehicle V-103',
          make: 'Toyota',
          model: 'HiAce',
          year: 2024,
          license_plate: 'Dubai B 78219',
          odometer_reading: 18_800,
          purchase_date: '2024-01-01',
        },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe')
        .mockResolvedValueOnce(mockVehicles) // vehicles
        .mockResolvedValueOnce([]) // telematics
        .mockResolvedValueOnce([]) // last service
        .mockResolvedValueOnce([]) // pm plans
        .mockResolvedValueOnce([]); // upcoming trips

      vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      const result = await PREVENTIVE_MAINTENANCE_AGENT.run({
        event_id: 'evt-1',
        event_type: 'manual.trigger',
        tenant_id: 'tenant-pm-test',
        timestamp: new Date().toISOString(),
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.itemsProcessed).toBe(1);
      expect(result.output.forecasts).toHaveLength(1);
      const f = result.output.forecasts[0];
      expect(f.vehicleCode).toBe('Vehicle V-103');
      expect(f.recommendedSlot).toBeDefined();
      expect(f.forecastNarrative).toContain('will reach its');
    });
  });

  describe('Dimension 5: REST API Endpoints', () => {
    it('POST /api/agents/preventive-maintenance/run triggers PM agent', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([]);
      vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      const req = new NextRequest('http://localhost:3000/api/agents/preventive-maintenance/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-api-test' },
        body: JSON.stringify({}),
      });

      const res = await runPOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.result.agentId).toBe('preventive-maintenance');
    });

    it('GET /api/agents/preventive-maintenance/forecasts returns formatted vehicle forecasts', async () => {
      const mockRows = [
        {
          id: 'f-1',
          vehicle_id: '11111111-1111-1111-1111-111111111103',
          vehicle_code: 'Vehicle V-103',
          license_plate: 'Dubai B 78219',
          make: 'Toyota',
          model: 'HiAce',
          current_odometer_km: 18800,
          current_engine_hours: 450,
          daily_avg_km: 200,
          daily_avg_engine_hours: 5.0,
          target_service_threshold: '20,000 km Service (Intermediate)',
          target_trigger_type: 'ODOMETER',
          remaining_km: 1200,
          remaining_engine_hours: 0,
          estimated_days_to_due: 6,
          projected_due_date: '2026-09-15',
          urgency_level: 'DUE_SOON',
          forecast_narrative: 'Vehicle V-103 will reach its 20,000 km threshold in approximately 6 operating days.',
          recommended_slot: JSON.stringify({
            slotDate: '2026-09-15',
            startTime: '13:00',
            endTime: '16:30',
            slotType: 'SHIFT_CHANGEOVER',
            disruptedTripsCount: 0,
            operationalDisruptionScore: 0,
          }),
          operational_impact_score: 0,
          status: 'ACTIVE',
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce(mockRows);

      const req = new NextRequest('http://localhost:3000/api/agents/preventive-maintenance/forecasts', {
        headers: { 'x-tenant-id': 'tenant-api-test' },
      });

      const res = await forecastsGET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.summary.totalForecasts).toBe(1);
      expect(data.forecasts[0].vehicleCode).toBe('Vehicle V-103');
      expect(data.forecasts[0].estimatedDaysToDue).toBe(6);
    });

    it('POST /api/agents/preventive-maintenance/book-slot commits work order with zero-disruption slot', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([{ count: BigInt(25) }]);
      vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      const req = new NextRequest('http://localhost:3000/api/agents/preventive-maintenance/book-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-api-test' },
        body: JSON.stringify({
          vehicleId: '11111111-1111-1111-1111-111111111103',
          forecastId: 'f-1',
          slotDate: '2026-09-15',
          startTime: '13:00',
          endTime: '16:30',
          serviceThreshold: '20,000 km Service (Intermediate)',
        }),
      });

      const res = await bookSlotPOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.woNumber).toContain('FWO-PM-');
      expect(data.scheduledSlot.slotDate).toBe('2026-09-15');
      expect(data.scheduledSlot.startTime).toBe('13:00');
    });
  });
});
