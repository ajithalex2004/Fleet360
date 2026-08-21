/**
 * tests/unit/plan-assign-vehicles.test.ts
 *
 * Unit tests for the smart vehicle-assignment algorithm
 * (lib/plan/assign-vehicles.ts) used by Planning Core's Apply step.
 */

import { describe, expect, it } from 'vitest';
import {
  assignVehiclesToBlocks,
  VEHICLE_GROUP_CONFLICT,
  type VehicleCandidate,
  type BlockVehicleRequirement,
} from '@/lib/plan/assign-vehicles';

function vehicle(opts: Partial<VehicleCandidate> & { id: string }): VehicleCandidate {
  return {
    licensePlate: null,
    seatingCapacity: null,
    vehicleGroup: null,
    zoneId: null,
    lat: null,
    lng: null,
    ...opts,
  };
}

function block(opts: Partial<BlockVehicleRequirement> & { blockId: string }): BlockVehicleRequirement {
  return {
    maxPassengers: 0,
    requiredVehicleGroup: null,
    zoneId: null,
    pickupPoint: { lat: null, lng: null },
    ...opts,
  };
}

describe('assignVehiclesToBlocks — capacity (hard gate)', () => {
  it('rejects a vehicle too small for the block and reports NO_CAPACITY_MATCH', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 20 })],
      [vehicle({ id: 'v1', seatingCapacity: 14 })],
    );
    expect(r[0].vehicleId).toBeNull();
    expect(r[0].reason).toBe('NO_CAPACITY_MATCH');
  });

  it('picks a vehicle whose capacity is exactly sufficient', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 14 })],
      [vehicle({ id: 'v1', seatingCapacity: 14 })],
    );
    expect(r[0].vehicleId).toBe('v1');
  });

  it('prefers the vehicle nearest pickup when fit is equal (isolating proximity from the fit tier)', () => {
    // Equal seatingCapacity (both waste the same 4 seats) — proximity is
    // the only thing that can distinguish them here.
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 10, pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'near', seatingCapacity: 14, lat: 25.10, lng: 55.20 }),
        vehicle({ id: 'far', seatingCapacity: 14, lat: 26.00, lng: 56.00 }),
      ],
    );
    expect(r[0].vehicleId).toBe('near');
  });
});

describe('assignVehiclesToBlocks — fit (soft ranking, tightest sufficient capacity)', () => {
  it('the exact scenario: 12 passengers, same zone, Hiace(13) vs Coaster(27) — picks the Hiace, not whichever plate sorts first', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 12, zoneId: 'zone-1', pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        // Coaster's plate ("DXB-A…") would have won on the old plate-only
        // tiebreaker despite wasting 15 seats vs the Hiace's 1.
        vehicle({ id: 'coaster', licensePlate: 'DXB-A-12345', seatingCapacity: 27, zoneId: 'zone-1', lat: 25.10, lng: 55.20 }),
        vehicle({ id: 'hiace',   licensePlate: 'DXB-B-54321', seatingCapacity: 13, zoneId: 'zone-1', lat: 25.10, lng: 55.20 }),
      ],
    );
    expect(r[0].vehicleId).toBe('hiace');
  });

  it('prefers the tighter fit even when the looser-fitting vehicle is closer', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 12, pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'tight-far', seatingCapacity: 13, lat: 26.00, lng: 56.00 }),
        vehicle({ id: 'loose-near', seatingCapacity: 27, lat: 25.101, lng: 55.201 }),
      ],
    );
    expect(r[0].vehicleId).toBe('tight-far');
  });

  it('a null-capacity vehicle that slipped through the maxPassengers<=0 edge case ranks last on fit, not as a false perfect match', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 0 })],
      [
        vehicle({ id: 'unknown-capacity', seatingCapacity: null }),
        vehicle({ id: 'known-capacity', seatingCapacity: 14 }),
      ],
    );
    expect(r[0].vehicleId).toBe('known-capacity');
  });

  it('zone still outranks fit — a cross-zone tight fit loses to a same-zone loose fit', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', maxPassengers: 12, zoneId: 'zone-1' })],
      [
        vehicle({ id: 'tight-wrong-zone', seatingCapacity: 13, zoneId: 'zone-2' }),
        vehicle({ id: 'loose-right-zone', seatingCapacity: 27, zoneId: 'zone-1' }),
      ],
    );
    expect(r[0].vehicleId).toBe('loose-right-zone');
  });
});

describe('assignVehiclesToBlocks — vehicle type (hard gate)', () => {
  it('rejects a type mismatch and reports NO_TYPE_MATCH', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', requiredVehicleGroup: 'BUS' })],
      [vehicle({ id: 'v1', vehicleGroup: 'VAN' })],
    );
    expect(r[0].vehicleId).toBeNull();
    expect(r[0].reason).toBe('NO_TYPE_MATCH');
  });

  it('accepts a matching type', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', requiredVehicleGroup: 'BUS' })],
      [vehicle({ id: 'v1', vehicleGroup: 'BUS' })],
    );
    expect(r[0].vehicleId).toBe('v1');
  });

  it('imposes no type constraint when the block has none', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', requiredVehicleGroup: null })],
      [vehicle({ id: 'v1', vehicleGroup: 'VAN' })],
    );
    expect(r[0].vehicleId).toBe('v1');
  });

  it('never matches when the block has conflicting requirements (VEHICLE_GROUP_CONFLICT sentinel)', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', requiredVehicleGroup: VEHICLE_GROUP_CONFLICT })],
      [vehicle({ id: 'v1', vehicleGroup: 'BUS' }), vehicle({ id: 'v2', vehicleGroup: 'VAN' })],
    );
    expect(r[0].vehicleId).toBeNull();
    expect(r[0].reason).toBe('CONFLICTING_VEHICLE_GROUP_REQUIREMENTS');
  });
});

describe('assignVehiclesToBlocks — zone (soft ranking, higher priority than distance)', () => {
  it('prefers a same-zone vehicle over a closer cross-zone one', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', zoneId: 'zone-north', pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'closer-wrong-zone', zoneId: 'zone-south', lat: 25.101, lng: 55.201 }),
        vehicle({ id: 'farther-same-zone', zoneId: 'zone-north', lat: 26.00, lng: 56.00 }),
      ],
    );
    expect(r[0].vehicleId).toBe('farther-same-zone');
    expect(r[0].zoneMatched).toBe(true);
  });

  it('does not exclude a cross-zone vehicle — falls back to it when no same-zone vehicle exists', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', zoneId: 'zone-north' })],
      [vehicle({ id: 'v1', zoneId: 'zone-south' })],
    );
    expect(r[0].vehicleId).toBe('v1');
    expect(r[0].zoneMatched).toBe(false);
  });

  it('treats an untagged block as a zone no-op — falls through to distance ranking', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', zoneId: null, pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'near', zoneId: 'zone-north', lat: 25.101, lng: 55.201 }),
        vehicle({ id: 'far', zoneId: 'zone-north', lat: 26.00, lng: 56.00 }),
      ],
    );
    expect(r[0].vehicleId).toBe('near');
    expect(r[0].zoneMatched).toBe(false);
  });

  it('treats an untagged vehicle as a zone no-op, not a same-zone match', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', zoneId: 'zone-north' })],
      [vehicle({ id: 'v1', zoneId: null })],
    );
    expect(r[0].vehicleId).toBe('v1');
    expect(r[0].zoneMatched).toBe(false);
  });
});

describe('assignVehiclesToBlocks — proximity (soft ranking)', () => {
  it('picks the nearest eligible vehicle to the pickup point', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'far', lat: 26.00, lng: 56.00 }),
        vehicle({ id: 'near', lat: 25.101, lng: 55.201 }),
        vehicle({ id: 'mid', lat: 25.50, lng: 55.60 }),
      ],
    );
    expect(r[0].vehicleId).toBe('near');
    expect(r[0].distanceKm).not.toBeNull();
  });

  it('does not exclude a vehicle with unknown position — just deprioritises it', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [vehicle({ id: 'unknown-position', lat: null, lng: null })],
    );
    expect(r[0].vehicleId).toBe('unknown-position');
    expect(r[0].distanceKm).toBeNull();
  });

  it('breaks a tie between two unknown-position vehicles deterministically by license plate', () => {
    // Regression test: distanceOrInfinity returns Infinity for both, and
    // Infinity - Infinity is NaN — a subtraction-based comparator would
    // short-circuit before reaching the plate tiebreaker. Run twice with
    // reversed input order to catch any lingering order-dependence.
    const vehicles = [vehicle({ id: 'z', licensePlate: 'DXB-B-54321' }), vehicle({ id: 'a', licensePlate: 'DXB-A-12345' })];
    const r1 = assignVehiclesToBlocks([block({ blockId: 'b1' })], vehicles);
    const r2 = assignVehiclesToBlocks([block({ blockId: 'b1' })], [...vehicles].reverse());
    expect(r1[0].vehicleId).toBe('a');
    expect(r2[0].vehicleId).toBe('a');
  });

  it('prefers a known-position vehicle over an unknown-position one', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1', pickupPoint: { lat: 25.10, lng: 55.20 } })],
      [
        vehicle({ id: 'unknown', lat: null, lng: null }),
        vehicle({ id: 'known-far', lat: 26.00, lng: 56.00 }),
      ],
    );
    expect(r[0].vehicleId).toBe('known-far');
  });
});

describe('assignVehiclesToBlocks — vehicle reuse across blocks', () => {
  it('never assigns the same vehicle to two blocks', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1' }), block({ blockId: 'b2' })],
      [vehicle({ id: 'only-vehicle' })],
    );
    expect(r[0].vehicleId).toBe('only-vehicle');
    expect(r[1].vehicleId).toBeNull();
    expect(r[1].reason).toBe('NO_VEHICLES_AVAILABLE');
  });

  it('assigns distinct vehicles to distinct blocks when enough are eligible', () => {
    const r = assignVehiclesToBlocks(
      [block({ blockId: 'b1' }), block({ blockId: 'b2' })],
      [vehicle({ id: 'v1' }), vehicle({ id: 'v2' })],
    );
    const ids = r.map((x) => x.vehicleId).sort();
    expect(ids).toEqual(['v1', 'v2']);
  });
});
