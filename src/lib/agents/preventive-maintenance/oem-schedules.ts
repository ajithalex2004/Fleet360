/**
 * OEM Maintenance Milestone Specifications & Standard Intervals
 * ----------------------------------------------------------------
 * Covers commercial passenger transport, heavy buses, vans, and utility fleets.
 */

export interface OEMServiceMilestone {
  intervalKm: number;
  intervalMonths: number;
  intervalHours?: number;
  tier: 'MINOR' | 'INTERMEDIATE' | 'MAJOR' | 'SEVERE_DUTY';
  label: string;
  operations: string[];
  estimatedDurationHours: number;
  estimatedCostAed: number;
}

export const STANDARD_OEM_MILESTONES: OEMServiceMilestone[] = [
  {
    intervalKm: 5_000,
    intervalMonths: 3,
    intervalHours: 250,
    tier: 'MINOR',
    label: '5,000 km Service (Minor A)',
    operations: [
      'Engine oil & oil filter replacement',
      'Fluid level inspection (coolant, brake fluid, windshield washer)',
      '30-point vehicle safety & tire pressure check',
      'Brake pad visual thickness inspection',
    ],
    estimatedDurationHours: 1.5,
    estimatedCostAed: 350,
  },
  {
    intervalKm: 10_000,
    intervalMonths: 6,
    intervalHours: 500,
    tier: 'MINOR',
    label: '10,000 km Service (Minor B)',
    operations: [
      'Engine oil & filter renewal (synthetic blend)',
      'Engine air filter cleaning / replacement',
      'Tire rotation and wheel balance inspection',
      'Suspension bushes & steering linkage check',
      'Battery terminal diagnostic and load test',
    ],
    estimatedDurationHours: 2.0,
    estimatedCostAed: 600,
  },
  {
    intervalKm: 20_000,
    intervalMonths: 12,
    intervalHours: 1_000,
    tier: 'INTERMEDIATE',
    label: '20,000 km Service (Intermediate)',
    operations: [
      'Full synthetic oil change & high-flow oil filter',
      'Cabin AC pollen filter replacement (UAE desert spec)',
      'Brake pad replacement and rotor runout measurement',
      'Fuel system cleaner & fuel filter inspection',
      'Throttle body & intake manifold cleaning',
      'Cooling system pressure test & hose inspection',
    ],
    estimatedDurationHours: 3.5,
    estimatedCostAed: 1_250,
  },
  {
    intervalKm: 40_000,
    intervalMonths: 24,
    intervalHours: 2_000,
    tier: 'MAJOR',
    label: '40,000 km Service (Major)',
    operations: [
      'Comprehensive transmission fluid & filter flush',
      'Brake fluid total flush (DOT 4 spec)',
      'Spark plugs / glow plugs replacement',
      'Drive belt & tensioner pulley replacement',
      'Front and rear axle differential oil renewal',
      'RTA compliance safety pre-inspection audit',
    ],
    estimatedDurationHours: 5.0,
    estimatedCostAed: 2_400,
  },
  {
    intervalKm: 80_000,
    intervalMonths: 48,
    intervalHours: 4_000,
    tier: 'SEVERE_DUTY',
    label: '80,000 km Service (Heavy Overhaul)',
    operations: [
      'Engine timing chain/belt renewal kit',
      'Complete engine radiator coolant flush and thermostat replacement',
      'Suspension shock absorbers & leaf spring bushing renewal',
      'Alternator and starter motor benchmark diagnostic',
      'Full emissions and exhaust catalytic system inspection',
    ],
    estimatedDurationHours: 7.5,
    estimatedCostAed: 4_500,
  },
];

/**
 * Finds the upcoming OEM service milestone based on current odometer km.
 */
export function getNextOEMMilestone(currentKm: number): {
  nextMilestone: OEMServiceMilestone;
  targetOdometerKm: number;
  remainingKm: number;
} {
  // If vehicle has 18,200 km, next is 20,000 km.
  // If vehicle has 38,000 km, next is 40,000 km.
  // Milestones cycle or scale:
  const sorted = [...STANDARD_OEM_MILESTONES].sort((a, b) => a.intervalKm - b.intervalKm);

  // Check direct intervals first
  for (const m of sorted) {
    if (currentKm < m.intervalKm) {
      return {
        nextMilestone: m,
        targetOdometerKm: m.intervalKm,
        remainingKm: Math.max(0, m.intervalKm - currentKm),
      };
    }
  }

  // If vehicle has high km (e.g. 115,000 km), calculate the next modulo milestone
  // Every 10,000 km is a service; every 20,000 is intermediate, every 40,000 is major.
  const nextTargetKm = Math.ceil((currentKm + 1) / 10_000) * 10_000;
  const isMajor = nextTargetKm % 40_000 === 0;
  const isIntermediate = nextTargetKm % 20_000 === 0 && !isMajor;

  const milestoneTemplate = isMajor
    ? sorted.find((s) => s.intervalKm === 40_000)!
    : isIntermediate
    ? sorted.find((s) => s.intervalKm === 20_000)!
    : sorted.find((s) => s.intervalKm === 10_000)!;

  return {
    nextMilestone: {
      ...milestoneTemplate,
      label: `${nextTargetKm.toLocaleString()} km Service (${milestoneTemplate.tier})`,
      intervalKm: nextTargetKm,
    },
    targetOdometerKm: nextTargetKm,
    remainingKm: Math.max(0, nextTargetKm - currentKm),
  };
}
