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

export const LEAD_TIME_RULES_HOURS: Record<string, number> = {
  EXECUTIVE: 2,
  LOGISTICS: 4,
  STAFF_TRANSPORT: 12,
  SCHOOL_BUS: 12,
  RENTAL: 2,
  LEASING: 24,
};

export const CATEGORY_SAMPLE_MODELS: Record<string, string> = {
  // Rental & Leasing
  'Economy': 'Nissan Sunny / Mitsubishi Attrage',
  'Compact': 'Toyota Yaris / Hyundai Accent',
  'Compact Sedan': 'Toyota Corolla / Hyundai Elantra',
  'Mid-Size': 'Toyota Camry / Honda Accord',
  'Mid-Size Sedan': 'Toyota Camry / Nissan Altima',
  'Full-Size': 'Nissan Maxima / Chevrolet Impala',
  'SUV': 'Toyota RAV4 / Hyundai Tucson',
  '4x4': 'Toyota Land Cruiser / Nissan Patrol',
  'Van': 'Toyota HiAce (14-Seater)',
  'Van (7-seater)': 'Kia Carnival / Toyota Innova',
  'Pickup Truck': 'Toyota Hilux / Isuzu D-Max',
  'Mini-Bus': 'Toyota Coaster (30-Seater)',
  'Bus': 'Yutong / King Long 50-Seat Coach',
  'Mixed Fleet': 'Custom Fleet Allocation',

  // Executive
  'Business Sedan': 'Lexus ES300h / BMW 5-Series',
  'Luxury Sedan': 'Mercedes-Benz S-Class / BMW 7-Series',
  'Luxury SUV': 'Range Rover Vogue / Cadillac Escalade',
  'Executive Van (MPV)': 'Mercedes-Benz V-Class Luxury VIP',
  'Stretch Limousine': 'Lincoln MKT / Chrysler 300 Limousine',
  'SUV Convoy': 'G-Wagon / Patrol VIP Escort',

  // Staff & School
  '14-Seat Minibus': 'Toyota HiAce High Roof',
  '30-Seat Coaster': 'Toyota Coaster AC Bus',
  '50-Seat Luxury Coach': 'Mercedes-Benz / King Long Coach',
  '22-Seat School Bus': 'Ashok Leyland Falcon School Bus',
  '30-Seat School Bus': 'Toyota Coaster RTA School Compliant',
  '50-Seat School Bus': 'Daewoo / Yutong RTA Certified School Bus',

  // Logistics
  '1-Ton Courier Van': 'Toyota HiAce Cargo Panel Van',
  '3-Ton Box Truck': 'Isuzu NPR 4.2m Dry Box Truck',
  '3-Ton Reefer (Cold-Chain)': 'Mitsubishi Fuso -18°C Chiller Truck',
  '7-Ton Curtain Sider': 'Hino 500 Heavy Cargo Truck',
  '40ft Flatbed Trailer': 'Mercedes-Benz Actros 40-Ton Rig',
  'FTL – Full Truck Load': 'Heavy Commercial Fleet',
  'LTL – Less than Truck Load': 'Consolidated Express Freight',
  'REEFER – Temperature Controlled': 'Pharma / Food Certified Cold-Chain',
};
