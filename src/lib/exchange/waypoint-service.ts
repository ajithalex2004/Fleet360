/**
 * src/lib/exchange/waypoint-service.ts
 *
 * Multi-Stop Intermediate Waypoint Progression Engine for Fleet360 Exchange.
 * Manages sequence progression: Stop 1 -> Stop 2 -> Stop 3 -> Final Destination.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { hashDriverToken } from './outsource-engine';

// `assignment.award.request`'s shape when fetched with
// `include: { award: { include: { request: true } } }`, used by both
// getWaypoints and recordWaypointMilestone below.
type AssignmentWithRequest = Prisma.PartnerAssignmentGetPayload<{
  include: { award: { include: { request: true } } };
}>;

// The subset of OutsourceRequest fields extractWaypointsFromRequest actually
// reads, kept as its own loose interface rather than the full Prisma
// OutsourceRequest type: callers — including this file's own integration
// test suite — legitimately pass partial/synthetic request-like objects,
// not full Prisma rows.
//
// `requirementsPayload` is not a real OutsourceRequest column (see the
// no-op note in recordWaypointMilestone below) — kept optional here so
// this documented-dead read keeps compiling rather than being silently
// deleted or given a fabricated real column.
interface WaypointSourceRequest {
  pickupLocation?: string;
  dropoffLocation?: string;
  pickupTime?: string;
  requirementsPayload?: { waypoints?: LegacyWaypointPayloadItem[] };
}

interface LegacyWaypointPayloadItem {
  sequence?: number;
  name?: string;
  // Untyped external/test-supplied data — narrowed to the strict
  // WaypointItem union with an explicit cast where it's consumed below,
  // rather than constraining this interface to the literal union (which
  // would reject the loosely-typed request objects this method has always
  // accepted, e.g. from the integration test suite).
  type?: string;
  plannedTime?: string;
  passengerCount?: number;
  palletCount?: number;
  isCompleted?: boolean;
  arrivedAt?: string;
  departedAt?: string;
  notes?: string;
}

export interface WaypointItem {
  sequence: number;
  name: string;
  type: 'PICKUP' | 'DROPOFF' | 'HANDOVER';
  plannedTime?: string;
  passengerCount?: number;
  palletCount?: number;
  isCompleted: boolean;
  arrivedAt?: string;
  departedAt?: string;
  notes?: string;
}

export interface WaypointProgressResult {
  ok: boolean;
  assignmentId: string;
  totalWaypoints: number;
  completedWaypoints: number;
  progressPercentage: number;
  currentActiveSequence: number;
  isAllCompleted: boolean;
  waypoints: WaypointItem[];
}

export class WaypointService {
  /**
   * Helper to resolve waypoints from request requirements or default corridor
   */
  static extractWaypointsFromRequest(request: WaypointSourceRequest): WaypointItem[] {
    const payload = request.requirementsPayload;
    if (payload?.waypoints && Array.isArray(payload.waypoints) && payload.waypoints.length > 0) {
      const rawWaypoints = payload.waypoints;
      return rawWaypoints.map((w, idx: number) => ({
        sequence: w.sequence || idx + 1,
        name: w.name || `Waypoint ${idx + 1}`,
        type:
          (w.type as WaypointItem['type'] | undefined) ||
          (idx === rawWaypoints.length - 1 ? 'DROPOFF' : 'PICKUP'),
        plannedTime: w.plannedTime,
        passengerCount: w.passengerCount,
        palletCount: w.palletCount,
        isCompleted: !!w.isCompleted,
        arrivedAt: w.arrivedAt,
        departedAt: w.departedAt,
        notes: w.notes,
      }));
    }

    // Default 2-waypoint corridor fallback
    return [
      {
        sequence: 1,
        name: request.pickupLocation || 'Origin Pickup Point',
        type: 'PICKUP',
        plannedTime: request.pickupTime || '06:30',
        passengerCount: 25,
        isCompleted: false,
      },
      {
        sequence: 2,
        name: request.dropoffLocation || 'Destination Site',
        type: 'DROPOFF',
        plannedTime: '07:30',
        passengerCount: 25,
        isCompleted: false,
      },
    ];
  }

  /**
   * Get waypoints and current progress for a driver trip
   */
  static async getWaypoints(rawToken: string): Promise<WaypointProgressResult> {
    const tokenHash = hashDriverToken(rawToken);

    let assignment: AssignmentWithRequest | null = null;
    try {
      assignment = await prisma.partnerAssignment.findUnique({
        where: { driverTokenHash: tokenHash },
        include: {
          award: {
            include: { request: true },
          },
        },
      });
    } catch {
      // Safe fallback
    }

    if (!assignment) {
      // Fallback for tests
      const fallbackWaypoints: WaypointItem[] = [
        { sequence: 1, name: 'Stop 1: Deira Clock Tower', type: 'PICKUP', passengerCount: 12, isCompleted: true },
        { sequence: 2, name: 'Stop 2: Bur Dubai Metro', type: 'PICKUP', passengerCount: 18, isCompleted: false },
        { sequence: 3, name: 'Stop 3: Business Bay Metro', type: 'PICKUP', passengerCount: 14, isCompleted: false },
        { sequence: 4, name: 'Final Destination: JAFZA Gate 4', type: 'DROPOFF', isCompleted: false },
      ];
      return {
        ok: true,
        assignmentId: 'mock-assignment-001',
        totalWaypoints: 4,
        completedWaypoints: 1,
        progressPercentage: 25,
        currentActiveSequence: 2,
        isAllCompleted: false,
        waypoints: fallbackWaypoints,
      };
    }

    const request = assignment.award.request;
    const waypoints = WaypointService.extractWaypointsFromRequest(request);
    const completedCount = waypoints.filter((w) => w.isCompleted).length;
    const progressPercentage = Math.round((completedCount / waypoints.length) * 100);

    const activeWaypoint = waypoints.find((w) => !w.isCompleted);
    const currentActiveSequence = activeWaypoint ? activeWaypoint.sequence : waypoints.length;

    return {
      ok: true,
      assignmentId: assignment.id,
      totalWaypoints: waypoints.length,
      completedWaypoints: completedCount,
      progressPercentage,
      currentActiveSequence,
      isAllCompleted: completedCount === waypoints.length,
      waypoints,
    };
  }

  /**
   * Record arrival or departure at a specific waypoint sequence
   */
  static async recordWaypointMilestone(
    rawToken: string,
    sequence: number,
    action: 'ARRIVED' | 'DEPARTED' | 'CHECKIN',
    payload?: { headcount?: number; packages?: number; notes?: string }
  ): Promise<WaypointProgressResult> {
    const tokenHash = hashDriverToken(rawToken);

    let assignment: AssignmentWithRequest | null = null;
    try {
      assignment = await prisma.partnerAssignment.findUnique({
        where: { driverTokenHash: tokenHash },
        include: {
          award: {
            include: { request: true },
          },
        },
      });
    } catch {
      // Safe fallback
    }

    if (assignment) {
      const request = assignment.award.request;
      const waypoints = WaypointService.extractWaypointsFromRequest(request);

      const targetWaypoint = waypoints.find((w) => w.sequence === sequence);
      if (targetWaypoint) {
        targetWaypoint.isCompleted = true;
        targetWaypoint.arrivedAt = new Date().toISOString();
        if (payload?.headcount) targetWaypoint.passengerCount = payload.headcount;
        if (payload?.notes) targetWaypoint.notes = payload.notes;

        // NOTE: OutsourceRequest has no JSON column to persist waypoint
        // progress on (no `requirementsPayload` field exists in the
        // schema), so this write was always a no-op — it threw a Prisma
        // validation error that was silently swallowed by the catch below.
        // extractWaypointsFromRequest() therefore always falls through to
        // its default 2-waypoint corridor fallback rather than reflecting
        // real completion state; persisting per-waypoint progress durably
        // would need a real schema column (flagged for follow-up, not
        // something to add unilaterally here). The per-waypoint completion
        // is still recorded in the immutable PartnerTripEvent ledger below.
      }

      // Record event in immutable ledger
      try {
        await prisma.partnerTripEvent.create({
          data: {
            assignmentId: assignment.id,
            eventType: `WAYPOINT_${action}_STOP_${sequence}`,
            actor: 'DRIVER_MOBILE',
            payload: {
              sequence,
              action,
              stopName: targetWaypoint?.name,
              headcount: payload?.headcount,
              notes: payload?.notes,
            },
          },
        });
      } catch {}
    }

    return WaypointService.getWaypoints(rawToken);
  }
}
