/**
 * Shared types/constants for fleet availability — split out of
 * src/app/api/fleet/availability/route.ts so client components can import
 * them without pulling in that route's server-only dependency chain
 * (route.ts -> @/lib/rls -> @/lib/rls-scope -> `import 'server-only'`),
 * which broke the production build the moment a client component imported
 * anything from the route file directly.
 */

export interface CategoryStock {
  category: string;
  availableCount: number;
  totalCount: number;
  lowStock: boolean;
  isAvailable: boolean;
  sampleModels: string;
  depots: Record<string, number>;
}

export interface AvailabilityResponse {
  serviceType: string;
  requestedDate?: string;
  leadTimeHoursRequired: number;
  leadTimeViolated: boolean;
  leadTimeWarning?: string;
  categories: CategoryStock[];
  depotsList: Array<{ id: string; name: string; city: string }>;
}

export const STANDARD_DEPOTS = [
  { id: 'DXB_HUB', name: 'Dubai Airport (DXB) Mobility Hub', city: 'Dubai' },
  { id: 'DSO_CENTRAL', name: 'Dubai Silicon Oasis (DSO) Central Depot', city: 'Dubai' },
  { id: 'JAFZA_LOGISTICS', name: 'Jebel Ali (JAFZA) Logistics Base', city: 'Dubai' },
  { id: 'AUH_YAS', name: 'Abu Dhabi Yas Island Operations Depot', city: 'Abu Dhabi' },
  { id: 'SHJ_AIRPORT', name: 'Sharjah Airport Transit Station', city: 'Sharjah' },
];
