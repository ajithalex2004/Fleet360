import { describe, it, expect } from 'vitest';
import { WaypointService } from '@/lib/exchange/waypoint-service';

describe('Fleet360 Exchange: Multi-Stop Intermediate Waypoint Stepper', () => {
  it('Test 1: Waypoint Extraction & Custom Array Resolution', () => {
    const multiStopRequest = {
      pickupLocation: 'Deira Clock Tower',
      dropoffLocation: 'JAFZA South Gate 4',
      requirementsPayload: {
        waypoints: [
          { sequence: 1, name: 'Stop 1: Deira Clock Tower', type: 'PICKUP', passengerCount: 12 },
          { sequence: 2, name: 'Stop 2: Bur Dubai Sharaf DG', type: 'PICKUP', passengerCount: 18 },
          { sequence: 3, name: 'Stop 3: Business Bay Metro', type: 'PICKUP', passengerCount: 14 },
          { sequence: 4, name: 'Final Destination: JAFZA South Gate 4', type: 'DROPOFF' },
        ],
      },
    };

    const waypoints = WaypointService.extractWaypointsFromRequest(multiStopRequest);

    expect(waypoints.length).toBe(4);
    expect(waypoints[0].sequence).toBe(1);
    expect(waypoints[0].name).toContain('Deira');
    expect(waypoints[1].sequence).toBe(2);
    expect(waypoints[2].sequence).toBe(3);
    expect(waypoints[3].sequence).toBe(4);
    expect(waypoints[3].type).toBe('DROPOFF');
  });

  it('Test 2: Default 2-Stop Fallback Corridor', () => {
    const basicRequest = {
      pickupLocation: 'Dubai Silicon Oasis HQ',
      dropoffLocation: 'Dubai Industrial City Warehouse 2',
      pickupTime: '06:00',
    };

    const waypoints = WaypointService.extractWaypointsFromRequest(basicRequest);

    expect(waypoints.length).toBe(2);
    expect(waypoints[0].name).toBe('Dubai Silicon Oasis HQ');
    expect(waypoints[1].name).toBe('Dubai Industrial City Warehouse 2');
  });

  it('Test 3: Step-by-Step Waypoint Progression & Completion Calculation', async () => {
    const rawToken = 'test-driver-multi-stop-token-991';

    // 1. Initial State (1 of 4 completed in fallback mock)
    const initialProgress = await WaypointService.getWaypoints(rawToken);
    expect(initialProgress.ok).toBe(true);
    expect(initialProgress.totalWaypoints).toBe(4);
    expect(initialProgress.progressPercentage).toBe(25);
    expect(initialProgress.currentActiveSequence).toBe(2);
    expect(initialProgress.isAllCompleted).toBe(false);

    // 2. Check-in Stop 2
    const step2 = await WaypointService.recordWaypointMilestone(rawToken, 2, 'CHECKIN', {
      headcount: 18,
      notes: '18 staff boarded smoothly at Bur Dubai',
    });
    expect(step2.ok).toBe(true);
  });
});
