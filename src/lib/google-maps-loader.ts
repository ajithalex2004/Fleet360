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

export interface GMapsLatLng { lat(): number; lng(): number }
interface GMapsLatLngLiteral { lat: number; lng: number }

export interface GMapsMVCArray<T = any> {
  getArray(): T[];
  getLength(): number;
  getAt(i: number): T;
  setAt(i: number, elem: T): void;
  insertAt(i: number, elem: T): void;
  removeAt(i: number): T;
  addListener(event: string, cb: (e?: any) => void): void;
  [key: string]: any;
}

export interface GMapsMap {
  addListener(event: string, cb: (e: { latLng?: GMapsLatLng }) => void): void;
  panTo(pos: GMapsLatLngLiteral): void;
  setZoom(z: number): void;
  setCenter?(pos: GMapsLatLngLiteral): void;
  fitBounds(bounds: GMapsLatLngBounds, padding?: number | { top: number; right: number; bottom: number; left: number }): void;
  setMapTypeId?(type: string): void;
  setOptions?(opts: object | null): void;
  [key: string]: any;
}
export interface GMapsMarker {
  setPosition(pos: GMapsLatLngLiteral): void;
  addListener(event: string, cb: (e?: any) => void): void;
  getPosition(): GMapsLatLng | null;
  setMap(map: GMapsMap | null): void;
}
export interface GMapsLatLngBounds {
  extend(pos: GMapsLatLngLiteral | GMapsLatLng): void;
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
  addListener(event: string, cb: (e?: any) => void): void;
}
export interface GMapsPolygon {
  setMap(map: GMapsMap | null): void;
  getPath(): GMapsMVCArray<GMapsLatLng>;
  setPath(path: GMapsLatLngLiteral[]): void;
  setOptions(opts: object): void;
  setEditable(editable: boolean): void;
  setDraggable(draggable: boolean): void;
  addListener(event: string, cb: (e?: any) => void): void;
  [key: string]: any;
}
export interface GMapsDrawingManager {
  setMap(map: GMapsMap | null): void;
  setDrawingMode(mode: string | null): void;
  setOptions(opts: object): void;
  addListener(event: string, cb: (payload: unknown) => void): void;
}
export interface GMapsInfoWindow {
  open(opts?: { map?: GMapsMap; anchor?: GMapsMarker }): void;
  close(): void;
  setContent(content: string | Node): void;
  setPosition(pos: GMapsLatLngLiteral | GMapsLatLng): void;
}

export interface GMapsAutocomplete {
  addListener(event: string, cb: (e?: any) => void): void;
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
  /** google.maps.SymbolPath enum — used for marker icon shapes. */
  SymbolPath: {
    CIRCLE: number;
    FORWARD_CLOSED_ARROW: number;
    FORWARD_OPEN_ARROW: number;
    BACKWARD_CLOSED_ARROW: number;
    BACKWARD_OPEN_ARROW: number;
  };
  Polyline: new (opts: object) => GMapsPolyline;
  Autocomplete: new (el: HTMLInputElement, opts?: object) => GMapsAutocomplete;
  /** Decode a Google encoded polyline string to lat/lng points. */
  decodePath: (encoded: string) => GMapsLatLng[];
  // Drawing-manager set — used by the Geofence Management page. Circle and
  // Polygon ctors also work as standalone overlays for rendering existing
  // geofences (they aren't only reachable through the manager).
  Circle: new (opts: object) => GMapsCircle;
  Polygon: new (opts: object) => GMapsPolygon;
  DrawingManager: new (opts?: object) => GMapsDrawingManager;
  InfoWindow: new (opts?: object) => GMapsInfoWindow;
  /** google.maps.drawing.OverlayType enum — 'circle' | 'polygon' | null etc. */
  OverlayType: { CIRCLE: string; POLYGON: string; MARKER: string; POLYLINE: string; RECTANGLE: string };
  MapTypeControlStyle?: any;
  ControlPosition?: any;
  [key: string]: any;
}

interface GoogleMapsBootstrap {
  // NOTE: LatLngBounds lives in 'core', not 'maps' — Google split the API
  // into sub-libraries when they introduced the async loader. Destructuring
  // it from 'maps' (which we used to do) throws
  // `google.maps.LatLngBounds is not a constructor`.
  importLibrary(name: 'core'):      Promise<{ LatLngBounds: GoogleCtors['LatLngBounds']; LatLng: GoogleCtors['LatLng']; SymbolPath: GoogleCtors['SymbolPath'] }>;
  importLibrary(name: 'maps'):      Promise<{ Map: GoogleCtors['Map']; Polyline: GoogleCtors['Polyline']; Circle: GoogleCtors['Circle']; Polygon: GoogleCtors['Polygon']; InfoWindow: GoogleCtors['InfoWindow'] }>;
  importLibrary(name: 'marker'):    Promise<{ Marker: GoogleCtors['Marker'] }>;
  importLibrary(name: 'geocoding'): Promise<{ Geocoder: GoogleCtors['Geocoder'] }>;
  importLibrary(name: 'places'):    Promise<{ Autocomplete: GoogleCtors['Autocomplete'] }>;
  importLibrary(name: 'geometry'):  Promise<{ encoding: { decodePath: (encoded: string) => GMapsLatLng[] } }>;
  importLibrary(name: 'drawing'):   Promise<{ DrawingManager: GoogleCtors['DrawingManager']; OverlayType: GoogleCtors['OverlayType'] }>;
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
    // In Google Maps JS API v3.65+, the drawing library and DrawingManager
    // were officially deprecated and removed. We catch any failure so the
    // rest of Google Maps (core, maps, marker, geocoding, places, geometry)
    // loads without throwing.
    const drawingLibPromise = bootstrap
      .importLibrary('drawing')
      .catch((err) => {
        console.warn('Google Maps drawing library unavailable or deprecated in v3.65+:', err?.message || err);
        return null;
      });

    const [coreLib, mapsLib, markerLib, geocodingLib, placesLib, geometryLib, drawingLib] = await Promise.all([
      bootstrap.importLibrary('core'),
      bootstrap.importLibrary('maps'),
      bootstrap.importLibrary('marker'),
      bootstrap.importLibrary('geocoding'),
      bootstrap.importLibrary('places'),
      bootstrap.importLibrary('geometry'),
      drawingLibPromise,
    ]);

    class FallbackDrawingManager implements GMapsDrawingManager {
      private map: GMapsMap | null = null;
      private mode: string | null = null;
      constructor(_opts?: object) {}
      setMap(map: GMapsMap | null) { this.map = map; }
      setDrawingMode(mode: string | null) { this.mode = mode; }
      setOptions(_opts: object) {}
      addListener(_event: string, _cb: (payload: unknown) => void) {}
    }

    const DrawingManagerCtor = (drawingLib && (drawingLib as any).DrawingManager) || FallbackDrawingManager;
    const OverlayTypeObj = (drawingLib && (drawingLib as any).OverlayType) || {
      CIRCLE: 'circle',
      POLYGON: 'polygon',
      MARKER: 'marker',
      POLYLINE: 'polyline',
      RECTANGLE: 'rectangle',
    };

    return {
      Map:            mapsLib.Map,
      Polyline:       mapsLib.Polyline,
      Circle:         mapsLib.Circle,
      Polygon:        mapsLib.Polygon,
      InfoWindow:     mapsLib.InfoWindow,
      LatLngBounds:   coreLib.LatLngBounds,   // ← 'core', not 'maps'
      LatLng:         coreLib.LatLng,
      SymbolPath:     coreLib.SymbolPath,
      Marker:         markerLib.Marker,
      Geocoder:       geocodingLib.Geocoder,
      Autocomplete:   placesLib.Autocomplete,
      decodePath:     geometryLib.encoding.decodePath,
      DrawingManager: DrawingManagerCtor as any,
      OverlayType:    OverlayTypeObj,
      MapTypeControlStyle: (window as any).google?.maps?.MapTypeControlStyle || { HORIZONTAL_BAR: 1, DROPDOWN_MENU: 2, DEFAULT: 0 },
      ControlPosition: (window as any).google?.maps?.ControlPosition || { TOP_RIGHT: 3, TOP_LEFT: 1 },
    };
  })();

  ctorsPromise.catch(() => { ctorsPromise = null; });
  return ctorsPromise;
}

/** Test helper — reset the cached loader (for unit / integration tests only). */
export function _resetGoogleMapsLoaderForTests(): void {
  ctorsPromise = null;
}
