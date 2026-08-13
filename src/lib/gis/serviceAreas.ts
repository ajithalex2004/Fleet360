/**
 * lib/gis/serviceAreas.ts — static, UAE-specific service-area data
 * for the multilayer GIS view. Real production would load these from
 * a geospatial database or a planning system (e.g. Trapeze Planner).
 *
 * Each layer is a self-contained array of features. The GIS view layer
 * toggles which layers to render on top of the Mapbox base map.
 *
 * Layer index:
 *   1. routes        — bus routes as polylines (origin → destination)
 *   2. stops         — bus stops as points
 *   3. serviceArea   — staff density as a GeoJSON polygon overlay
 *   4. demographics  — population density heatmap (simulated)
 *   5. traffic       — major highways / arterial roads
 *   6. landmarks     — points of interest (malls, hospitals, schools)
 *
 * All coordinates are WGS84 (lat/lng). Dubai-centric.
 */

export type GisLayerId = 'routes' | 'stops' | 'serviceArea' | 'demographics' | 'traffic' | 'landmarks';

export interface GisLayerMeta {
  id: GisLayerId;
  label: string;
  description: string;
  color: string;
  defaultVisible: boolean;
}

export const GIS_LAYERS: GisLayerMeta[] = [
  { id: 'routes',       label: 'Bus Routes',           description: 'Active staff transport routes (polyline).',  color: '#8b5cf6', defaultVisible: true },
  { id: 'stops',        label: 'Stops',                 description: 'All bus stops across the network (points).',  color: '#22d3ee', defaultVisible: true },
  { id: 'serviceArea',  label: 'Service Area',          description: 'Staff density catchment (filled polygon).',  color: '#f59e0b', defaultVisible: true },
  { id: 'demographics', label: 'Population Density',    description: 'Simulated population density heatmap (1km grid).', color: '#ec4899', defaultVisible: false },
  { id: 'traffic',      label: 'Major Roads',           description: 'Highways and arterials for context (Dhabi + Sheikh Zayed).', color: '#64748b', defaultVisible: true },
  { id: 'landmarks',    label: 'Landmarks',             description: 'Major POI: hospitals, schools, malls, transit hubs.', color: '#10b981', defaultVisible: false },
];

// ── Static feature data ──────────────────────────────────────────────────

export interface RouteFeature {
  id: string;
  name: string;
  origin: string;
  destination: string;
  /** Polyline as [lat, lng] pairs (Mapbox convention is [lng, lat], but
   *  we use [lat, lng] here for human-readability and convert at draw time. */
  coordinates: Array<[number, number]>;
}

export interface StopFeature {
  id: string;
  name: string;
  lat: number;
  lng: number;
  routeId?: string;
}

export interface PolygonFeature {
  id: string;
  name: string;
  /** [lat, lng] ring; close the loop by repeating the first vertex. */
  ring: Array<[number, number]>;
  /** Density 0-100 used for the heatmap fill colour. */
  density: number;
}

export interface LineFeature {
  id: string;
  name: string;
  coordinates: Array<[number, number]>;
}

export interface PointFeature {
  id: string;
  name: string;
  category: 'HOSPITAL' | 'SCHOOL' | 'MALL' | 'TRANSIT' | 'OFFICE_PARK';
  lat: number;
  lng: number;
}

// Dubai-centric demo data. Real production pulls from the trip-schedule
// + route_stop tables plus a geocoding service.

const ROUTES: RouteFeature[] = [
  {
    id: 'r1', name: 'Route 1 — Dubai Marina ↔ DIFC', origin: 'Dubai Marina', destination: 'DIFC',
    coordinates: [[25.0805, 55.1407], [25.0780, 55.1350], [25.0750, 55.1300], [25.0700, 55.1200], [25.0650, 55.1100], [25.0500, 55.1000], [25.0300, 55.0900], [25.0200, 55.0800], [25.0100, 55.0700], [25.0050, 55.0550]],
  },
  {
    id: 'r2', name: 'Route 2 — JLT ↔ Downtown', origin: 'JLT', destination: 'Downtown',
    coordinates: [[25.0720, 55.1430], [25.0750, 55.1400], [25.0800, 55.1350], [25.0850, 55.1300], [25.0900, 55.1250], [25.1000, 55.1200], [25.1100, 55.1150], [25.1200, 55.1100], [25.1300, 55.1000], [25.1500, 55.0900], [25.1700, 55.0800], [25.1900, 55.0700], [25.2000, 55.0650]],
  },
  {
    id: 'r3', name: 'Route 3 — Deira ↔ Business Bay', origin: 'Deira', destination: 'Business Bay',
    coordinates: [[25.2700, 55.3100], [25.2600, 55.3000], [25.2500, 55.2900], [25.2400, 55.2800], [25.2200, 55.2700], [25.2000, 55.2600], [25.1800, 55.2500], [25.1600, 55.2400], [25.1400, 55.2300], [25.1200, 55.2200], [25.1000, 55.2100], [25.0800, 55.2000], [25.0500, 55.1900], [25.0200, 55.1800]],
  },
];

const STOPS: StopFeature[] = [
  { id: 's1', name: 'Dubai Marina Tram',     lat: 25.0805, lng: 55.1407, routeId: 'r1' },
  { id: 's2', name: 'JBR Walk',              lat: 25.0780, lng: 55.1350, routeId: 'r1' },
  { id: 's3', name: 'Media City',            lat: 25.0650, lng: 55.1100, routeId: 'r1' },
  { id: 's4', name: 'Internet City',         lat: 25.0300, lng: 55.0900, routeId: 'r1' },
  { id: 's5', name: 'DIFC Gate',             lat: 25.0050, lng: 55.0550, routeId: 'r1' },
  { id: 's6', name: 'JLT Cluster H',         lat: 25.0720, lng: 55.1430, routeId: 'r2' },
  { id: 's7', name: 'Damac Heights',         lat: 25.0900, lng: 55.1250, routeId: 'r2' },
  { id: 's8', name: 'Business Bay',          lat: 25.1900, lng: 55.0700, routeId: 'r2' },
  { id: 's9', name: 'Downtown Dubai',        lat: 25.2000, lng: 55.0650, routeId: 'r2' },
  { id: 's10', name: 'Al Ras Metro',         lat: 25.2700, lng: 55.3100, routeId: 'r3' },
  { id: 's11', name: 'Bur Dubai',             lat: 25.2200, lng: 55.2700, routeId: 'r3' },
  { id: 's12', name: 'Karama',                lat: 25.1200, lng: 55.2200, routeId: 'r3' },
  { id: 's13', name: 'Trade Centre',          lat: 25.0500, lng: 55.1900, routeId: 'r3' },
];

const SERVICE_AREA: PolygonFeature[] = [
  { id: 'sa1', name: 'Dubai Marina catchment', density: 80, ring: [
    [25.1100, 55.1100], [25.1100, 55.1500], [25.0500, 55.1500], [25.0500, 55.1100], [25.1100, 55.1100],
  ] },
  { id: 'sa2', name: 'Downtown catchment', density: 70, ring: [
    [25.2200, 55.0300], [25.2200, 55.0900], [25.1800, 55.0900], [25.1800, 55.0300], [25.2200, 55.0300],
  ] },
  { id: 'sa3', name: 'Deira catchment', density: 60, ring: [
    [25.3000, 55.2800], [25.3000, 55.3300], [25.2400, 55.3300], [25.2400, 55.2800], [25.3000, 55.2800],
  ] },
];

const TRAFFIC: LineFeature[] = [
  { id: 't1', name: 'Sheikh Zayed Road',    coordinates: [[25.2400, 55.2700], [25.2200, 55.2500], [25.1900, 55.2300], [25.1500, 55.2100], [25.1000, 55.1800], [25.0500, 55.1500], [25.0000, 55.1100], [24.9500, 55.0700]] },
  { id: 't2', name: 'Al Khail Road',        coordinates: [[25.2700, 55.3100], [25.2400, 55.2900], [25.2000, 55.2700], [25.1500, 55.2500], [25.1000, 55.2300], [25.0500, 55.2100], [25.0000, 55.2000], [24.9500, 55.1900]] },
  { id: 't3', name: 'Emirates Road',        coordinates: [[25.2700, 55.2900], [25.2400, 55.2500], [25.2000, 55.2200], [25.1500, 55.1900], [25.1000, 55.1600], [25.0500, 55.1300], [25.0000, 55.1000]] },
];

const LANDMARKS: PointFeature[] = [
  { id: 'l1', name: 'Dubai Mall',           category: 'MALL',       lat: 25.1972, lng: 55.2796 },
  { id: 'l2', name: 'Mall of the Emirates', category: 'MALL',       lat: 25.1180, lng: 55.2003 },
  { id: 'l3', name: 'Dubai Hospital',       category: 'HOSPITAL',   lat: 25.2467, lng: 55.3173 },
  { id: 'l4', name: 'American Hospital',    category: 'HOSPITAL',   lat: 25.2285, lng: 55.3180 },
  { id: 'l5', name: 'GEMS Dubai American Academy', category: 'SCHOOL', lat: 25.0850, lng: 55.1500 },
  { id: 'l6', name: 'Dubai International School',  category: 'SCHOOL', lat: 25.1500, lng: 55.2500 },
  { id: 'l7', name: 'DMCC Metro',           category: 'TRANSIT',    lat: 25.0700, lng: 55.1400 },
  { id: 'l8', name: 'Burj Khalifa Metro',   category: 'TRANSIT',    lat: 25.1972, lng: 55.2744 },
  { id: 'l9', name: 'DIFC Gate',            category: 'TRANSIT',    lat: 25.0050, lng: 55.0550 },
  { id: 'l10', name: 'Dubai Internet City',  category: 'OFFICE_PARK', lat: 25.0300, lng: 55.0900 },
  { id: 'l11', name: 'Dubai Media City',     category: 'OFFICE_PARK', lat: 25.0650, lng: 55.1100 },
  { id: 'l12', name: 'Business Bay',         category: 'OFFICE_PARK', lat: 25.1900, lng: 55.0700 },
];

// Simulated population density heatmap — 1km grid points around Dubai
const DEMOGRAPHICS: PointFeature[] = (() => {
  const out: PointFeature[] = [];
  let id = 1;
  for (let lat = 25.0; lat <= 25.3; lat += 0.01) {
    for (let lng = 55.0; lng <= 55.4; lng += 0.01) {
      // Synthetic density — higher near key hubs
      const dxc = Math.abs(lng - 55.18);
      const dtc = Math.abs(lat - 25.18);
      const dist = Math.sqrt(dxc * dxc + dtc * dtc);
      const density = Math.max(0, Math.min(100, 100 - dist * 250));
      if (density > 20) {
        out.push({ id: `pop_${id++}`, name: `Cell ${lat.toFixed(2)},${lng.toFixed(2)}`, category: 'HOSPITAL', lat, lng });
      }
    }
  }
  return out;
})();

export const GIS_DATA = {
  routes:       ROUTES,
  stops:        STOPS,
  serviceArea:  SERVICE_AREA,
  demographics: DEMOGRAPHICS,
  traffic:      TRAFFIC,
  landmarks:    LANDMARKS,
};
