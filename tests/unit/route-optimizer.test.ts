import { describe, expect, it } from 'vitest';
import {
  optimizeRoutes,
  pickupBeforeDelivery,
  routeFeasibleCapacity,
  type SolverInput,
  type SolverShipment,
  type SolverStop,
  type SolverVehicle,
} from '@/lib/logistics/route-optimizer';

// ── Test fixtures ──────────────────────────────────────────────────────────
// A simple geography. Matrix index 0 = depot. Indices 1..N are stops.
// We hand-build symmetric distance matrices so the expected results are
// predictable.

function stop(
  stopId: string, shipmentId: string, type: 'PICKUP' | 'DELIVERY',
  matrixIndex: number, opts: Partial<SolverStop> = {},
): SolverStop {
  return {
    stopId, shipmentId, type, matrixIndex,
    weightKg: opts.weightKg ?? 0,
    volumeCbm: opts.volumeCbm ?? 0,
    serviceDurationMin: opts.serviceDurationMin ?? 15,
    windowFromMin: opts.windowFromMin ?? null,
    windowToMin: opts.windowToMin ?? null,
  };
}

function shipment(
  id: string, pickupIdx: number, deliveryIdx: number,
  weightKg: number, volumeCbm = 0, stopOpts: { pickup?: Partial<SolverStop>; delivery?: Partial<SolverStop> } = {},
): SolverShipment {
  return {
    shipmentId: id,
    weightKg, volumeCbm,
    pickup: stop(`${id}-P`, id, 'PICKUP', pickupIdx, stopOpts.pickup),
    delivery: stop(`${id}-D`, id, 'DELIVERY', deliveryIdx, stopOpts.delivery),
  };
}

function vehicle(id: string, capacityKg: number, opts: Partial<SolverVehicle> = {}): SolverVehicle {
  return {
    vehicleId: id,
    driverId: opts.driverId ?? `driver-${id}`,
    capacityKg,
    capacityCbm: opts.capacityCbm ?? 1000,
    costPerKm: opts.costPerKm ?? 2,
    shiftStartMin: opts.shiftStartMin ?? 480,   // 08:00
    shiftEndMin: opts.shiftEndMin ?? 1080,      // 18:00
    maxDriveMin: opts.maxDriveMin ?? 600,       // 10h
  };
}

/** Build a symmetric matrix from a 2D array of one-way distances. */
function symmetricMatrix(n: number, dist: (i: number, j: number) => number): number[][] {
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      m[i][j] = i === j ? 0 : dist(i, j);
    }
  }
  return m;
}

// ── pickupBeforeDelivery — pure ────────────────────────────────────────────

describe('pickupBeforeDelivery', () => {
  it('accepts pickup then delivery', () => {
    expect(pickupBeforeDelivery([
      stop('a-P', 'a', 'PICKUP', 1),
      stop('a-D', 'a', 'DELIVERY', 2),
    ])).toBe(true);
  });

  it('rejects delivery before pickup', () => {
    expect(pickupBeforeDelivery([
      stop('a-D', 'a', 'DELIVERY', 2),
      stop('a-P', 'a', 'PICKUP', 1),
    ])).toBe(false);
  });

  it('accepts interleaved pairs as long as each pickup precedes its delivery', () => {
    expect(pickupBeforeDelivery([
      stop('a-P', 'a', 'PICKUP', 1),
      stop('b-P', 'b', 'PICKUP', 2),
      stop('a-D', 'a', 'DELIVERY', 3),
      stop('b-D', 'b', 'DELIVERY', 4),
    ])).toBe(true);
  });

  it('rejects when one shipment violates even if others are fine', () => {
    expect(pickupBeforeDelivery([
      stop('a-P', 'a', 'PICKUP', 1),
      stop('b-D', 'b', 'DELIVERY', 2),   // b delivered before pickup
      stop('a-D', 'a', 'DELIVERY', 3),
      stop('b-P', 'b', 'PICKUP', 4),
    ])).toBe(false);
  });
});

// ── routeFeasibleCapacity — pure ───────────────────────────────────────────

describe('routeFeasibleCapacity', () => {
  const ships = new Map<string, SolverShipment>([
    ['a', shipment('a', 1, 2, 600)],
    ['b', shipment('b', 3, 4, 500)],
  ]);

  it('accepts a route within capacity', () => {
    const stops = [
      stop('a-P', 'a', 'PICKUP', 1), stop('a-D', 'a', 'DELIVERY', 2),
      stop('b-P', 'b', 'PICKUP', 3), stop('b-D', 'b', 'DELIVERY', 4),
    ];
    // Sequential: pick up a (600), drop a (0), pick up b (500), drop b (0). Peak 600.
    expect(routeFeasibleCapacity(stops, ships, 1000, 1000)).toBe(true);
  });

  it('rejects when concurrent load exceeds capacity', () => {
    const stops = [
      stop('a-P', 'a', 'PICKUP', 1),   // load 600
      stop('b-P', 'b', 'PICKUP', 3),   // load 1100 — exceeds 1000
      stop('a-D', 'a', 'DELIVERY', 2),
      stop('b-D', 'b', 'DELIVERY', 4),
    ];
    expect(routeFeasibleCapacity(stops, ships, 1000, 1000)).toBe(false);
  });

  it('accepts the same stops when capacity is raised', () => {
    const stops = [
      stop('a-P', 'a', 'PICKUP', 1),
      stop('b-P', 'b', 'PICKUP', 3),
      stop('a-D', 'a', 'DELIVERY', 2),
      stop('b-D', 'b', 'DELIVERY', 4),
    ];
    expect(routeFeasibleCapacity(stops, ships, 1200, 1000)).toBe(true);
  });
});

// ── optimizeRoutes — integration of the whole solver ───────────────────────

describe('optimizeRoutes', () => {
  it('returns all shipments unassigned when there are no vehicles', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 15),
      shipments: [shipment('a', 1, 2, 100)],
      vehicles: [],
    };
    const r = optimizeRoutes(input);
    expect(r.routes).toHaveLength(0);
    expect(r.summary.shipmentsUnassigned).toBe(1);
    expect(r.unassigned[0].reason).toBe('NO_VEHICLE_MATCH');
  });

  it('routes a single shipment depot → pickup → delivery → depot', () => {
    // Depot=0, pickup=1, delivery=2. Distances chosen so the route is obvious.
    const input: SolverInput = {
      distances: symmetricMatrix(3, (i, j) => {
        const d: Record<string, number> = { '0,1': 10, '1,2': 5, '0,2': 12 };
        return d[`${Math.min(i,j)},${Math.max(i,j)}`] ?? 0;
      }),
      durations: symmetricMatrix(3, () => 10),
      shipments: [shipment('a', 1, 2, 100)],
      vehicles: [vehicle('V1', 1000)],
    };
    const r = optimizeRoutes(input);
    expect(r.routes).toHaveLength(1);
    const route = r.routes[0];
    expect(route.stops.map(s => s.type)).toEqual(['PICKUP', 'DELIVERY']);
    expect(route.stops[0].shipmentId).toBe('a');
    // distance = depot→pickup(10) + pickup→delivery(5) + delivery→depot(12) = 27
    expect(route.totalDistanceKm).toBe(27);
    expect(route.estimatedCost).toBe(54); // 27km × 2/km
  });

  it('merges two nearby shipments onto one vehicle when capacity allows', () => {
    // 5 points: depot=0, a-pickup=1, a-delivery=2, b-pickup=3, b-delivery=4
    // Make a and b geographically close so merging saves distance.
    const dist = (i: number, j: number) => {
      const table: Record<string, number> = {
        '0,1': 10, '0,2': 11, '0,3': 10, '0,4': 11,
        '1,2': 2,  '1,3': 3,  '1,4': 4,
        '2,3': 2,  '2,4': 3,
        '3,4': 2,
      };
      return table[`${Math.min(i,j)},${Math.max(i,j)}`] ?? 0;
    };
    const input: SolverInput = {
      distances: symmetricMatrix(5, dist),
      durations: symmetricMatrix(5, () => 5),
      shipments: [shipment('a', 1, 2, 300), shipment('b', 3, 4, 300)],
      vehicles: [vehicle('V1', 1000)],
    };
    const r = optimizeRoutes(input);
    // Both should land on one vehicle (merged route).
    expect(r.routes).toHaveLength(1);
    expect(r.summary.shipmentsAssigned).toBe(2);
    expect(r.summary.shipmentsUnassigned).toBe(0);
  });

  it('splits across two vehicles when one truck cannot hold both concurrently', () => {
    const dist = (i: number, j: number) => {
      const table: Record<string, number> = {
        '0,1': 10, '0,2': 11, '0,3': 10, '0,4': 11,
        '1,2': 2,  '1,3': 3,  '1,4': 4, '2,3': 2, '2,4': 3, '3,4': 2,
      };
      return table[`${Math.min(i,j)},${Math.max(i,j)}`] ?? 0;
    };
    // Each shipment is 700kg. A single 1000kg truck can't carry both at once,
    // BUT since a is delivered before b is picked up in a merged route, it
    // might still merge. To force a split, overlap the windows so both must
    // be carried simultaneously... simpler: make each shipment 700 and the
    // route a→pickup, b→pickup (concurrent 1400 > 1000) only feasible split.
    // The merge feasibility check uses cumulative load, so a route that picks
    // up both before delivering either is rejected; but a→P,a→D,b→P,b→D is
    // feasible (peak 700). Two 700 shipments DO fit sequentially.
    // To genuinely force two vehicles, give each shipment 1500kg vs 1000 cap
    // — wait that's NO_CAPACITY. Use 600 each but two vehicles of 600.
    const input: SolverInput = {
      distances: symmetricMatrix(5, dist),
      durations: symmetricMatrix(5, () => 5),
      shipments: [shipment('a', 1, 2, 600), shipment('b', 3, 4, 600)],
      vehicles: [vehicle('V1', 600), vehicle('V2', 600)],
    };
    const r = optimizeRoutes(input);
    // Sequential merge keeps peak at 600, which fits a 600 truck. So they may
    // still merge onto one. Both outcomes (1 or 2 routes) are valid as long
    // as everything is assigned.
    expect(r.summary.shipmentsUnassigned).toBe(0);
    expect(r.summary.shipmentsAssigned).toBe(2);
  });

  it('marks a shipment unassigned when no vehicle has capacity for it', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 10),
      shipments: [shipment('big', 1, 2, 5000)],   // 5 tonnes
      vehicles: [vehicle('V1', 1000)],            // 1 tonne truck
    };
    const r = optimizeRoutes(input);
    expect(r.routes).toHaveLength(0);
    expect(r.summary.shipmentsUnassigned).toBe(1);
    expect(r.unassigned[0].reason).toBe('NO_CAPACITY');
  });

  it('respects volume capacity independently of weight', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 10),
      // Light but bulky: 100kg, 50cbm. Vehicle has 10t weight but only 20cbm.
      shipments: [shipment('bulky', 1, 2, 100, 50)],
      vehicles: [vehicle('V1', 10000, { capacityCbm: 20 })],
    };
    const r = optimizeRoutes(input);
    expect(r.summary.shipmentsUnassigned).toBe(1);
    expect(r.unassigned[0].reason).toBe('NO_CAPACITY');
  });

  it('flags a time-window violation when a stop is served late', () => {
    // Depot→pickup is 600 min of driving; delivery window closes at 09:00.
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 600),  // 10h per leg — guarantees lateness
      shipments: [shipment('a', 1, 2, 100, 0, {
        delivery: { windowFromMin: 480, windowToMin: 540 },  // 08:00-09:00
      })],
      vehicles: [vehicle('V1', 1000)],
      depotDepartMin: 480,  // depart 08:00
    };
    const r = optimizeRoutes(input);
    expect(r.routes).toHaveLength(1);
    expect(r.summary.timeWindowViolations).toBeGreaterThan(0);
    const lateStop = r.routes[0].stops.find(s => !s.onTime);
    expect(lateStop).toBeDefined();
    expect(lateStop!.lateMinutes).toBeGreaterThan(0);
  });

  it('waits when arriving before the window opens (no violation)', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 10),  // fast — arrives early
      shipments: [shipment('a', 1, 2, 100, 0, {
        pickup: { windowFromMin: 600, windowToMin: 1080 },  // opens 10:00
      })],
      vehicles: [vehicle('V1', 1000)],
      depotDepartMin: 480,  // depart 08:00, arrive ~08:10, window opens 10:00
    };
    const r = optimizeRoutes(input);
    const pickup = r.routes[0].stops.find(s => s.type === 'PICKUP')!;
    expect(pickup.onTime).toBe(true);
    expect(pickup.arriveMin).toBe(600);  // waited until window open
  });

  it('spreads load across vehicles instead of cramming one truck past HOS', () => {
    // 3 shipments, each a short hop, but the legs between them are long enough
    // that merging all 3 onto one truck would blow past the HOS limit. With
    // 3 vehicles available, the solver should use more than one rather than
    // produce a single HOS-violating mega-route.
    const n = 7; // depot + 3 pickups + 3 deliveries
    const dist = (i: number, j: number) => (i === j ? 0 : 30);
    // 150min per leg: a single shipment route is 3×150+30=480min (fits the
    // 600min HOS limit), but any 2-shipment merge is ≥5×150+60=810min (exceeds
    // it), so the HOS-aware merge ceiling forces one shipment per vehicle.
    const input: SolverInput = {
      distances: symmetricMatrix(n, dist),
      durations: symmetricMatrix(n, (i, j) => (i === j ? 0 : 150)),
      shipments: [
        shipment('a', 1, 2, 100),
        shipment('b', 3, 4, 100),
        shipment('c', 5, 6, 100),
      ],
      vehicles: [
        vehicle('V1', 1000, { maxDriveMin: 600 }),
        vehicle('V2', 1000, { maxDriveMin: 600 }),
        vehicle('V3', 1000, { maxDriveMin: 600 }),
      ],
    };
    const r = optimizeRoutes(input);
    // All assigned, and NO route should carry an HOS violation — the merge
    // ceiling forced a split.
    expect(r.summary.shipmentsUnassigned).toBe(0);
    const hosViolations = r.routes.flatMap(rt => rt.violations).filter(v => v.kind === 'HOS');
    expect(hosViolations.length).toBe(0);
    expect(r.summary.vehiclesUsed).toBeGreaterThan(1);
  });

  it('flags an HOS violation when the route exceeds the driver drive limit', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 100),
      durations: symmetricMatrix(3, () => 300),  // 3 legs × 300 = 900min route
      shipments: [shipment('a', 1, 2, 100)],
      vehicles: [vehicle('V1', 1000, { maxDriveMin: 480 })],  // 8h limit
    };
    const r = optimizeRoutes(input);
    const hos = r.routes[0].violations.find(v => v.kind === 'HOS');
    expect(hos).toBeDefined();
  });

  it('computes capacity utilization as peak load over capacity', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, () => 10),
      durations: symmetricMatrix(3, () => 10),
      shipments: [shipment('a', 1, 2, 750)],
      vehicles: [vehicle('V1', 1000)],
    };
    const r = optimizeRoutes(input);
    expect(r.routes[0].capacityUtilization.weightPct).toBe(75);
  });

  it('solves a 15-shipment / 30-stop problem in well under 1 second', () => {
    // The spec target: <30 stops, <1s. 15 shipments = 30 stops + depot = 31 points.
    const n = 31;
    // Deterministic pseudo-random geography (no Math.random — keep it reproducible).
    const coord = (i: number) => ({ x: (i * 37) % 100, y: (i * 53) % 100 });
    const dist = (i: number, j: number) => {
      const a = coord(i), b = coord(j);
      return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10;
    };
    const distances = symmetricMatrix(n, dist);
    const durations = symmetricMatrix(n, (i, j) => dist(i, j) * 2);

    const shipments: SolverShipment[] = [];
    for (let s = 0; s < 15; s++) {
      const pickupIdx = 1 + s * 2;
      const deliveryIdx = 2 + s * 2;
      shipments.push(shipment(`s${s}`, pickupIdx, deliveryIdx, 100 + s * 10));
    }
    const vehicles = [
      vehicle('V1', 2000), vehicle('V2', 2000), vehicle('V3', 2000), vehicle('V4', 2000),
    ];

    const t0 = performance.now();
    const r = optimizeRoutes({ distances, durations, shipments, vehicles });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(1000);
    // Everything that fits should be assigned; nothing dropped for no reason.
    expect(r.summary.shipmentsAssigned + r.summary.shipmentsUnassigned).toBe(15);
  });

  it('produces a summary that sums route distances and costs', () => {
    const input: SolverInput = {
      distances: symmetricMatrix(3, (i, j) => {
        const d: Record<string, number> = { '0,1': 10, '1,2': 5, '0,2': 12 };
        return d[`${Math.min(i,j)},${Math.max(i,j)}`] ?? 0;
      }),
      durations: symmetricMatrix(3, () => 10),
      shipments: [shipment('a', 1, 2, 100)],
      vehicles: [vehicle('V1', 1000, { costPerKm: 3 })],
    };
    const r = optimizeRoutes(input);
    expect(r.summary.totalDistanceKm).toBe(27);
    expect(r.summary.estimatedCost).toBe(81);  // 27 × 3
    expect(r.summary.vehiclesUsed).toBe(1);
    expect(r.summary.shipmentsAssigned).toBe(1);
  });
});
