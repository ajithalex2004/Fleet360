/**
 * google-maps-loader — one shared, lazy Google Maps JS SDK loader for the
 * whole app.
 *
 * Uses Google's official Dynamic Library Import bootstrap (inline snippet
 * from the docs, adapted for a runtime API key). Advantages over appending
 * a plain `<script src=".../js?loading=async">` tag:
 *   - Synchronously defines `google.maps.importLibrary`
 *   - Actual SDK is only fetched when the first importLibrary() call runs
 *   - No server-side branch on which bootstrap variant Google returns
 *     (fixes the intermittent "google.maps has no importLibrary" bug)
 *
 * Anything in the app that needs the JS SDK (pickers, tracking maps,
 * previews) imports { loadGoogleMaps } from here — same promise, same
 * result, no duplicate script tags.
 */

// ── Types (minimal — we only touch what we use to avoid a huge @types dep) ──

/** Opaque event-listener handle returned by addListener/addListenerOnce. */
export interface GMapsEventListener { remove(): void }

interface GMapsLatLng { lat(): number; lng(): number }
interface GMapsLatLngLiteral { lat: number; lng: number }

export interface GMapsMap {
  addListener(event: string, cb: (e: { latLng?: GMapsLatLng }) => void): GMapsEventListener;
  panTo(pos: GMapsLatLngLiteral): void;
  setZoom(z: number): void;
  fitBounds(bounds: GMapsLatLngBounds, padding?: number | { top: number; right: number; bottom: number; left: number }): void;
  setOptions(opts: object): void;
}
export interface GMapsMarker {
  setPosition(pos: GMapsLatLngLiteral): void;
  addListener(event: string, cb: () => void): void;
  getPosition(): GMapsLatLng | null;
  setMap(map: GMapsMap | null): void;
}
export interface GMapsLatLngBounds {
  extend(pos: GMapsLatLngLiteral): void;
  isEmpty(): boolean;
}
export interface GMapsPolyline {
  setMap(map: GMapsMap | null): void;
  setPath(path: GMapsLatLngLiteral[]): void;
}
export interface GMapsCircle {
  setMap(map: GMapsMap | null): void;
  getCenter(): GMapsLatLng | null;
  getRadius(): number;
  setCenter(pos: GMapsLatLngLiteral): void;
  setRadius(r: number): void;
  setOptions(opts: object): void;
  addListener(event: string, cb: () => void): void;
}
export interface GMapsPolygon {
  setMap(map: GMapsMap | null): void;
  getPath(): { getArray(): GMapsLatLng[]; getLength(): number };
  setPath(path: GMapsLatLngLiteral[]): void;
  setOptions(opts: object): void;
  addListener(event: string, cb: () => void): void;
}
export interface GMapsDrawingManager {
  setMap(map: GMapsMap | null): void;
  setDrawingMode(mode: string | null): void;
  setOptions(opts: object): void;
  addListener(event: string, cb: (payload: unknown) => void): void;
}
export interface GMapsAutocomplete {
  addListener(event: string, cb: () => void): void;
  getPlace(): {
    geometry?: { location?: GMapsLatLng };
    name?: string;
    formatted_address?: string;
  };
}
interface GMapsGeocoderResult {
  formatted_address?: string;
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
}
export interface GMapsGeocoder {
  geocode(
    request: { location: GMapsLatLngLiteral },
    cb: (results: GMapsGeocoderResult[] | null, status: string) => void,
  ): void;
}

export interface GoogleCtors {
  Map: new (el: Element, opts: object) => GMapsMap;
  Marker: new (opts: object) => GMapsMarker;
  Geocoder: new () => GMapsGeocoder;
  LatLngBounds: new () => GMapsLatLngBounds;
  LatLng: new (lat: number, lng: number) => GMapsLatLng;
  Polyline: new (opts: object) => GMapsPolyline;
  Autocomplete: new (el: HTMLInputElement, opts?: object) => GMapsAutocomplete;
  /** Decode a Google encoded polyline string to lat/lng points. */
  decodePath: (encoded: string) => GMapsLatLng[];
  /** Symbol path constants for custom markers */
  SymbolPath: { CIRCLE: number; FORWARD_CLOSED_ARROW: number; FORWARD_OPEN_ARROW: number; BACKWARD_CLOSED_ARROW: number; BACKWARD_OPEN_ARROW: number };
  // Circle and Polygon ctors for rendering geofences and custom drawing
  Circle: new (opts: object) => GMapsCircle;
  Polygon: new (opts: object) => GMapsPolygon;
}

interface GoogleMapsBootstrap {
  // NOTE: LatLngBounds lives in 'core', not 'maps' — Google split the API
  // into sub-libraries when they introduced the async loader. Destructuring
  // it from 'maps' (which we used to do) throws
  // `google.maps.LatLngBounds is not a constructor`.
  importLibrary(name: 'core'):      Promise<{ LatLngBounds: GoogleCtors['LatLngBounds']; LatLng: GoogleCtors['LatLng']; SymbolPath: GoogleCtors['SymbolPath'] }>;
  importLibrary(name: 'maps'):      Promise<{ Map: GoogleCtors['Map']; Polyline: GoogleCtors['Polyline']; Circle: GoogleCtors['Circle']; Polygon: GoogleCtors['Polygon'] }>;
  importLibrary(name: 'marker'):    Promise<{ Marker: GoogleCtors['Marker'] }>;
  importLibrary(name: 'geocoding'): Promise<{ Geocoder: GoogleCtors['Geocoder'] }>;
  importLibrary(name: 'places'):    Promise<{ Autocomplete: GoogleCtors['Autocomplete'] }>;
  importLibrary(name: 'geometry'):  Promise<{ encoding: { decodePath: (encoded: string) => GMapsLatLng[] } }>;
}

declare global {
  interface Window { google?: { maps: GoogleMapsBootstrap } }
}

// ── Loader ────────────────────────────────────────────────────────────────

const JS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;

let ctorsPromise: Promise<GoogleCtors> | null = null;

/**
 * Google's official inline bootstrap loader, adapted to accept our runtime
 * API key. Synchronously installs `google.maps.importLibrary`; the actual
 * SDK is downloaded the first time importLibrary() is called.
 */
function installGoogleBootstrap(apiKey: string): void {
  if ((window as unknown as { google?: { maps?: { importLibrary?: unknown } } }).google?.maps?.importLibrary) return;

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
  ((g: any) => {
    let h: Promise<void> | undefined;
    let a: HTMLScriptElement | undefined;
    let k: string;
    const p = 'The Google Maps JavaScript API';
    const c = 'google';
    const l = 'importLibrary';
    const q = '__ib__';
    const m = document;
    const b: any = window;
    const bg = b[c] || (b[c] = {});
    const d = bg.maps || (bg.maps = {});
    const r = new Set<string>();
    const e = new URLSearchParams();
    const u = () => h || (h = new Promise<void>((f, n) => {
      a = m.createElement('script');
      e.set('libraries', Array.from(r).join(','));
      for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), g[k]);
      e.set('callback', c + '.maps.' + q);
      a.src = 'https://maps.googleapis.com/maps/api/js?' + e.toString();
      d[q] = f;
      a.onerror = () => { h = undefined; n(new Error(p + ' could not load.')); };
      a.nonce = (m.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce || '';
      m.head.appendChild(a);
    }));
    d[l] ? console.warn(p + ' only loads once. Ignoring:', g) : (d[l] = (f: string, ...n: unknown[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key: apiKey, v: 'weekly' });
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
}

/**
 * Load every Google Maps sub-library we use across the app in parallel.
 * Cached module-wide so multiple simultaneous callers all wait on the same
 * promise and only one download ever happens.
 */
export function loadGoogleMaps(): Promise<GoogleCtors> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR — loadGoogleMaps must run in a browser'));
  if (ctorsPromise) return ctorsPromise;
  if (!JS_KEY) {
    return Promise.reject(new Error(
      'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not configured (or NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY as fallback).',
    ));
  }

  installGoogleBootstrap(JS_KEY);
  ctorsPromise = (async () => {
    const bootstrap = window.google?.maps;
    if (!bootstrap || typeof bootstrap.importLibrary !== 'function') {
      throw new Error(
        'Google Maps bootstrap missing after install — check the Network tab for the maps.googleapis.com request and the browser Console for a specific …MapError from Google.',
      );
    }
    const [coreLib, mapsLib, markerLib, geocodingLib, placesLib, geometryLib] = await Promise.all([
      bootstrap.importLibrary('core'),
      bootstrap.importLibrary('maps'),
      bootstrap.importLibrary('marker'),
      bootstrap.importLibrary('geocoding'),
      bootstrap.importLibrary('places'),
      bootstrap.importLibrary('geometry'),
    ]);
    return {
      Map:            mapsLib.Map,
      Polyline:       mapsLib.Polyline,
      Circle:         mapsLib.Circle,
      Polygon:        mapsLib.Polygon,
      LatLngBounds:   coreLib.LatLngBounds,   // ← 'core', not 'maps'
      LatLng:         coreLib.LatLng,
      SymbolPath:     coreLib.SymbolPath,
      Marker:         markerLib.Marker,
      Geocoder:       geocodingLib.Geocoder,
      Autocomplete:   placesLib.Autocomplete,
      decodePath:     geometryLib.encoding.decodePath,
    };
  })();

  ctorsPromise.catch(() => { ctorsPromise = null; });
  return ctorsPromise;
}

/** Test helper — reset the cached loader (for unit / integration tests only). */
export function _resetGoogleMapsLoaderForTests(): void {
  ctorsPromise = null;
}
