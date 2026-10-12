import 'server-only';

export type HomepageSnapshot = {
  vehiclesLive: number;
  fleetUtilization: number;
  uptime: number;
  lowerOperatingCosts: number;
  source: 'configured' | 'illustrative';
  asOf: string;
};

const fallbackSnapshot = {
  vehiclesLive: 392,
  fleetUtilization: 78,
  uptime: 99.7,
  lowerOperatingCosts: 28,
};

function numberFromEnv(name: string, fallback: number, max = Number.POSITIVE_INFINITY) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

/**
 * Reads the explicitly approved, public-safe homepage snapshot. Operators can
 * update these values from their deployment configuration without exposing a
 * tenant database or turning the marketing page into an authenticated report.
 */
export function getHomepageSnapshot(): HomepageSnapshot {
  const configured = ['FLEET360_PUBLIC_VEHICLES_LIVE', 'FLEET360_PUBLIC_FLEET_UTILIZATION_PERCENT', 'FLEET360_PUBLIC_UPTIME_PERCENT', 'FLEET360_PUBLIC_COST_REDUCTION_PERCENT']
    .some((name) => process.env[name]?.trim());
  return {
    vehiclesLive: numberFromEnv('FLEET360_PUBLIC_VEHICLES_LIVE', fallbackSnapshot.vehiclesLive),
    fleetUtilization: numberFromEnv('FLEET360_PUBLIC_FLEET_UTILIZATION_PERCENT', fallbackSnapshot.fleetUtilization, 100),
    uptime: numberFromEnv('FLEET360_PUBLIC_UPTIME_PERCENT', fallbackSnapshot.uptime, 100),
    lowerOperatingCosts: numberFromEnv('FLEET360_PUBLIC_COST_REDUCTION_PERCENT', fallbackSnapshot.lowerOperatingCosts, 100),
    source: configured ? 'configured' : 'illustrative',
    asOf: process.env.FLEET360_PUBLIC_SNAPSHOT_AS_OF?.trim() || new Date().toISOString(),
  };
}
