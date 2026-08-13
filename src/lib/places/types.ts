/**
 * Shared vocabulary for the geospatial `Place` primitive.
 *
 * PlaceType and PlaceShape are stored as free-text in `spatial.places.type`
 * and `.shape` (see the migration under `prisma/raw/add_spatial_places.sql`
 * — deliberately NOT a Postgres enum so a new type doesn't need a DDL
 * change; the app enforces the vocabulary here instead).
 */

export const PLACE_TYPES = [
  'STOP',                 // A boarding/alighting point on a route
  'GEOFENCE',             // Generic bounded area used for arrival/proximity checks
  'DEPOT',                // Bus/vehicle depot — start-of-day and end-of-day home
  'GARAGE',               // Maintenance/service facility
  'WAREHOUSE',            // Cargo storage / staging
  'OPERATIONAL_ZONE',     // Broad city zone used for demand/routing analytics
  'ORIGIN_DESTINATION',   // Named OD pair endpoint (bus-ops legacy category)
  'BASE_CAMP',            // Field or remote-work base
  'ACCOMMODATION',        // Staff accommodation site
  'PORT',                 // Sea/air port
  'CUSTOMER_SITE',        // Delivery or pickup at a customer location
] as const;

export type PlaceType = typeof PLACE_TYPES[number];

export const PLACE_SHAPES = ['POINT', 'CIRCLE', 'POLYGON'] as const;
export type PlaceShape = typeof PLACE_SHAPES[number];

/** Grouping used by the Locations page so related types render together. */
export const PLACE_TYPE_GROUPS: Array<{ label: string; types: PlaceType[] }> = [
  { label: 'Transport network',   types: ['STOP', 'GEOFENCE', 'OPERATIONAL_ZONE'] },
  { label: 'Facilities',          types: ['DEPOT', 'GARAGE', 'WAREHOUSE'] },
  { label: 'Sites',               types: ['ORIGIN_DESTINATION', 'BASE_CAMP', 'ACCOMMODATION', 'PORT', 'CUSTOMER_SITE'] },
];

export function isPlaceType(v: unknown): v is PlaceType {
  return typeof v === 'string' && (PLACE_TYPES as readonly string[]).includes(v);
}

export function isPlaceShape(v: unknown): v is PlaceShape {
  return typeof v === 'string' && (PLACE_SHAPES as readonly string[]).includes(v);
}

/** Human-facing labels for menus. Keep in sync with PLACE_TYPES. */
export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  STOP:                'Stop',
  GEOFENCE:            'Geofence',
  DEPOT:               'Depot',
  GARAGE:              'Garage',
  WAREHOUSE:           'Warehouse',
  OPERATIONAL_ZONE:    'Operational zone',
  ORIGIN_DESTINATION:  'Origin/destination',
  BASE_CAMP:           'Base camp',
  ACCOMMODATION:       'Accommodation',
  PORT:                'Port',
  CUSTOMER_SITE:       'Customer site',
};
