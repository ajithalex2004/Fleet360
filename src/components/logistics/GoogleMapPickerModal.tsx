'use client';
/**
 * GoogleMapPickerModal — drop-a-pin location picker built on Google Maps JS.
 *
 * Public interface is identical to LocationPickerModal so callers can swap
 * imports (props + returned PickedLocation are the same). Uses:
 *   - Google Maps JavaScript API   (map + marker)
 *   - Google Places Autocomplete   (search box)
 *   - Google Geocoder              (reverse-geocode click / drag)
 *
 * The SDK is loaded lazily on first open via a single global promise, so
 * mounting this component in the tree costs nothing until the user actually
 * clicks a pick button.
 *
 * Key config: reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (browser-facing key,
 * required — must have Maps JavaScript + Places APIs enabled and be locked
 * down by HTTP referrer in Google Cloud). Falls back to
 * NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY as a convenience if the embed key
 * happens to also have JS enabled, though separate keys per API surface is
 * the recommended production posture.
 *
 * When no key is available the component renders a friendly configuration
 * notice instead of a broken map — text fields in the caller's form still
 * work for manual entry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';

// ── Minimal Google Maps types (reach the global via cast, avoid @types dep) ──
// We only touch the surface we use; a full typing would drag ~1MB of types.

interface GMapsLatLng { lat(): number; lng(): number }
interface GMapsLatLngLiteral { lat: number; lng: number }
interface GMapsMap {
  addListener(event: string, cb: (e: { latLng?: GMapsLatLng }) => void): void;
  panTo(pos: GMapsLatLngLiteral): void;
  setZoom(z: number): void;
}
interface GMapsMarker {
  setPosition(pos: GMapsLatLngLiteral): void;
  addListener(event: string, cb: () => void): void;
  getPosition(): GMapsLatLng | null;
  setMap(map: GMapsMap | null): void;
}
interface GMapsAutocomplete {
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
  // Google returns a `types` array on each result identifying what KIND of
  // location it is (e.g. 'establishment', 'point_of_interest', 'street_address').
  // We use this to prefer POI results over plain street-address results
  // when picking the label for a dropped pin.
  types?: string[];
}
interface GMapsGeocoder {
  geocode(
    request: { location: GMapsLatLngLiteral },
    cb: (results: GMapsGeocoderResult[] | null, status: string) => void,
  ): void;
}

// Constructors returned by the async importLibrary calls.
interface GoogleCtors {
  Map: new (el: Element, opts: object) => GMapsMap;
  Marker: new (opts: object) => GMapsMarker;
  Geocoder: new () => GMapsGeocoder;
  Autocomplete: new (el: HTMLInputElement, opts?: object) => GMapsAutocomplete;
}

// The `Window.google` global is declared once in @/lib/google-maps-loader
// (which owns the SDK bootstrap). We use `any` casts locally when we need
// to touch it because our importLibrary shape here is a subset — the loader
// module has the full type.

// ── Lazy SDK loader (module-scoped promise, shared across instances) ─────

const JS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;

let ctorsPromise: Promise<GoogleCtors> | null = null;

/**
 * Diagnoses what `window.google` actually contains when bootstrap fails, so
 * the thrown error tells the user the *real* cause instead of a generic
 * "script may have failed to initialise".
 *
 * Common shapes we see in the wild:
 *   - window.google is undefined            → script didn't load (CSP/ad blocker/network)
 *   - window.google.maps is undefined        → script loaded but `libraries=...` filter
 *                                              blocked the maps sub-library (or key is bad)
 *   - window.google.maps.AuthenticationError → API key invalid / referrer restricted
 *   - window.google.maps.importLibrary is not a function → wrong script version (e.g. legacy
 *                                              sync loader) loaded instead of `loading=async`
 *   - window.google.maps is an object but importLibrary is missing → key restricted to a
 *                                              referrer that doesn't match the current origin
 */
function diagnoseBootstrap(): string {
  const w = typeof window === 'undefined' ? undefined : (window as any).google;
  if (!w) {
    return 'window.google is undefined — the Google Maps script never loaded. '
      + 'Likely causes: ad blocker, CSP, or the script tag was rejected by the browser. '
      + 'Open DevTools → Network and look for the request to https://maps.googleapis.com/maps/api/js.';
  }
  if (!w.maps) {
    return `window.google exists but window.google.maps is undefined. `
      + `The script loaded but did not register the maps sub-library. `
      + `window.google = ${JSON.stringify(Object.keys(w))}. `
      + `This usually means the API key is invalid, or the key is restricted to an HTTP referrer that doesn't match the current origin. `
      + `Check the Network tab for the maps.googleapis.com response and the Google Cloud Console for the key's referrer restrictions.`;
  }
  if (typeof w.maps.importLibrary !== 'function') {
    return `window.google.maps exists but does not expose importLibrary. `
      + `This means the legacy synchronous Google Maps loader was used instead of the modern loading=async bootstrap. `
      + `window.google.maps = ${JSON.stringify(Object.keys(w.maps))}. `
      + `Make sure the script URL includes "loading=async" (we do) and that no other code on the page is loading Google Maps with the old API.`;
  }
  // Shouldn't reach here — caller only invokes when importLibrary is missing.
  return 'Unknown bootstrap failure — window.google.maps.importLibrary was missing but the diagnostic check could not determine why.';
}

/**
 * Google's recommended "Dynamic Library Import" bootstrap loader. Unlike
 * appending a plain `<script src=".../js?loading=async">` tag (which relies
 * on the response being the async bootstrap variant — Google's server
 * sometimes serves the legacy loader instead, giving us
 * `window.google.maps = {modules, __gjsload__, Load}` with no importLibrary),
 * this synchronously defines `google.maps.importLibrary` and defers the
 * actual SDK download to the first import call. Guaranteed to give us the
 * modern loader shape.
 *
 * Verbatim (minified) from
 * https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import
 */
function installGoogleBootstrap(apiKey: string): void {
  // Defensive: if a previous load already installed importLibrary, don't
  // clobber it. If the legacy shape is in place, we DO overwrite so callers
  // get a working modern surface.
  if ((window as unknown as { google?: { maps?: { importLibrary?: unknown } } }).google?.maps?.importLibrary) return;

  // The following block is Google's official inline bootstrap loader, adapted
  // to accept our runtime `apiKey` instead of a hard-coded string. It sets
  // window.google.maps.importLibrary(name) which returns a promise for that
  // sub-library, and lazy-loads the actual SDK on the first call.
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
      a.src = `https://maps.googleapis.com/maps/api/js?` + e.toString();
      d[q] = f;
      a.onerror = () => { h = undefined; n(new Error(p + ' could not load.')); };
      a.nonce = (m.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce || '';
      m.head.appendChild(a);
    }));
    d[l] ? console.warn(p + ' only loads once. Ignoring:', g) : (d[l] = (f: string, ...n: unknown[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key: apiKey, v: 'weekly' });
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
}

function loadGoogleMaps(): Promise<GoogleCtors> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (ctorsPromise) return ctorsPromise;
  if (!JS_KEY) {
    return Promise.reject(new Error(
      'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not configured (or NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY as fallback).',
    ));
  }

  ctorsPromise = new Promise<GoogleCtors>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const importAll = async () => {
      const bootstrap = (window as any).google?.maps;
      if (!bootstrap || typeof bootstrap.importLibrary !== 'function') {
        // Throw the diagnostic message — much more useful than the old
        // "script may have failed to initialise" which left users guessing.
        throw new Error(diagnoseBootstrap());
      }
      try {
        const [mapsLib, markerLib, geocodingLib, placesLib] = await Promise.all([
          bootstrap.importLibrary('maps'),
          bootstrap.importLibrary('marker'),
          bootstrap.importLibrary('geocoding'),
          bootstrap.importLibrary('places'),
        ]);
        return {
          Map: mapsLib.Map,
          Marker: markerLib.Marker,
          Geocoder: geocodingLib.Geocoder,
          Autocomplete: placesLib.Autocomplete,
        };
      } catch (libErr) {
        // The bootstrap loaded but one of the importLibrary calls failed —
        // usually a sign that a specific Google API isn't enabled for the key
        // (e.g. Places API not enabled → importLibrary('places') rejects).
        throw new Error(
          `google.maps.importLibrary() failed: ${libErr instanceof Error ? libErr.message : String(libErr)}. `
          + `This usually means the API key is valid but one of the required Google APIs (Maps JavaScript, Places, Geocoding) is not enabled for the project. `
          + `Check Google Cloud Console → APIs & Services → Library and enable any missing APIs.`,
        );
      }
    };

    // Install Google's dynamic-library-import bootstrap. Synchronously defines
    // window.google.maps.importLibrary; the actual SDK script is fetched by
    // importLibrary itself the first time we call it (inside importAll below).
    // This bypasses the "server sometimes serves the legacy loader" bug
    // seen with the plain <script src="..?loading=async"> approach.
    installGoogleBootstrap(JS_KEY);
    importAll().then(
      (ctors) => settle(() => resolve(ctors)),
      (err)   => settle(() => { ctorsPromise = null; reject(err); }),
    );
  });

  // Reset the cache on error so a future call can retry after a transient
  // failure (e.g. user fixes the API key restriction in Google Cloud).
  ctorsPromise.catch(() => { ctorsPromise = null; });
  return ctorsPromise;
}

// ── Public API ──────────────────────────────────────────────────────────

export interface PickedLocation { name: string; address: string; lat: number; lng: number }

// Default: Dubai (matches the Mapbox picker's default centre for continuity).
const UAE_CENTER: GMapsLatLngLiteral = { lat: 25.2048, lng: 55.2708 };

export default function GoogleMapPickerModal({
  open, title, initial, initialSearchQuery, onClose, onPick,
}: {
  open: boolean;
  title: string;
  initial?: { lat: number; lng: number; label?: string } | null;
  /** Text to pre-fill the search box with. Independent from `initial` (which
   *  requires coords). Use this when you have a NAME for the location but no
   *  coordinates yet — the operator can just press Enter to Google-search it. */
  initialSearchQuery?: string;
  onClose: () => void;
  onPick: (loc: PickedLocation) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const markerRef = useRef<GMapsMarker | null>(null);
  const geocoderRef = useRef<GMapsGeocoder | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<GMapsAutocomplete | null>(null);

  const [coords, setCoords] = useState<GMapsLatLngLiteral | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [name, setName] = useState(initial?.label ?? '');
  const [address, setAddress] = useState(initial?.label ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Reverse-geocode a clicked / dragged point into a readable address.
  //
  // Google returns multiple results ordered from most-specific to least-
  // specific. For a plain point on a road, `results[0]` is typically a
  // `street_address` whose first address_component is `street_number` —
  // yielding useless labels like "2" or "207". To get the POI/landmark
  // name the operator actually cares about, we:
  //   1. Scan for a result with POI-like types (establishment, POI, premise,
  //      park, airport, transit_station, etc.)
  //   2. If found, use ITS formatted_address (first line = POI name)
  //   3. Otherwise use the first result but with formatted_address.split(',')[0]
  //      which at least gives "207 Al Reem Ave" instead of just "207"
  //   4. Address is the full formatted string in either case
  const reverseGeocode = useCallback((lat: number, lng: number) => {
    const g = geocoderRef.current;
    if (!g) return;
    setGeocoding(true);
    g.geocode({ location: { lat, lng } }, (results, status) => {
      setGeocoding(false);
      if (status !== 'OK' || !results?.[0]) {
        setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        setName('');
        return;
      }

      const POI_TYPES = ['establishment', 'point_of_interest', 'premise', 'park', 'airport', 'transit_station', 'shopping_mall', 'university', 'school', 'hospital', 'stadium', 'tourist_attraction'];
      const poiResult = results.find(r => (r.types ?? []).some(t => POI_TYPES.includes(t)));
      const best = poiResult ?? results[0];

      const formatted = best.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const firstLine = formatted.split(',')[0].trim();

      // If the first line is JUST digits (e.g. "207") — Google's short
      // street-number-only case — try the next non-country/political
      // component for a better name. If that's also just digits, fall
      // back to two lines of the formatted address ("207 Al Reem Ave").
      const isJustNumber = /^\d+$/.test(firstLine);
      let displayName = firstLine;
      if (isJustNumber) {
        const parts = formatted.split(',').map(s => s.trim());
        const twoLines = parts.slice(0, 2).join(', ');
        displayName = twoLines || firstLine;
      }

      setName(displayName);
      setAddress(formatted);
    });
  }, []);

  // Drop / move the pin. Recomputes coords, moves marker, reverse-geocodes.
  const placePin = useCallback((lat: number, lng: number) => {
    setCoords({ lat, lng });
    const marker = markerRef.current;
    if (marker) marker.setPosition({ lat, lng });
    const map = mapRef.current;
    if (map) { map.panTo({ lat, lng }); }
    reverseGeocode(lat, lng);
  }, [reverseGeocode]);

  // Initialise map + marker + autocomplete on first open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadGoogleMaps().then((ctors) => {
      if (cancelled) return;
      const container = mapDivRef.current;
      if (!container) return;

      const start = coords ?? UAE_CENTER;
      const map = new ctors.Map(container, {
        center: start,
        zoom: coords ? 15 : 11,
        // Nice-to-have controls; keeps the surface familiar without cluttering.
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;

      const marker = new ctors.Marker({
        map,
        position: start,
        draggable: true,
      });
      markerRef.current = marker;
      marker.addListener('dragend', () => {
        const p = marker.getPosition();
        if (p) placePin(p.lat(), p.lng());
      });

      map.addListener('click', (e) => {
        if (!e.latLng) return;
        placePin(e.latLng.lat(), e.latLng.lng());
      });

      geocoderRef.current = new ctors.Geocoder();

      if (searchInputRef.current) {
        const ac = new ctors.Autocomplete(searchInputRef.current, {
          fields: ['geometry', 'name', 'formatted_address'],
        });
        autocompleteRef.current = ac;
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          const loc = place.geometry?.location;
          if (!loc) return;
          const lat = loc.lat();
          const lng = loc.lng();
          setName(place.name ?? '');
          setAddress(place.formatted_address ?? '');
          setCoords({ lat, lng });
          marker.setPosition({ lat, lng });
          map.panTo({ lat, lng });
          map.setZoom(16);
        });
      }

      // If we opened with initial coords but no label, reverse-geocode them
      // so the confirm button has something readable.
      if (coords && !name && !address) reverseGeocode(coords.lat, coords.lng);

      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
      setLoading(false);
    });

    return () => {
      cancelled = true;
      // Cleanup handled implicitly when the modal unmounts; the Google Map
      // instance and marker are garbage-collected with their DOM container.
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
      geocoderRef.current = null;
      autocompleteRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-violet-400" />
            {title}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        {!JS_KEY ? (
          <div className="p-6 text-sm text-amber-300 bg-amber-500/10 border-t border-amber-500/30">
            Google Maps API key not configured. Set <code className="text-white">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your environment
            (Maps JavaScript API + Places API enabled, restricted to your app&rsquo;s HTTP referrers).
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-white/10 relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                ref={searchInputRef}
                // Pre-fill with initialSearchQuery when the caller has a
                // NAME but no coords for the location. `defaultValue` (not
                // `value`) so Google's Autocomplete widget can take control.
                defaultValue={initialSearchQuery || undefined}
                placeholder="Search a place, address, landmark…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500"
                autoFocus
              />
            </div>

            <div className="relative flex-1 min-h-[350px] bg-slate-800">
              <div ref={mapDivRef} className="absolute inset-0" />
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-slate-300 text-sm">
                  Loading Google Maps…
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-rose-500/10 text-rose-300 text-sm p-4 text-center">
                  {error}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Selected location</div>
              <div className="text-sm text-white font-medium truncate">{name || <span className="text-slate-500">— Click on the map to drop a pin —</span>}</div>
              <div className="text-xs text-slate-400 truncate">{geocoding ? 'Getting address…' : (address || (coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : ''))}</div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!coords}
                  onClick={() => {
                    if (!coords) return;
                    onPick({
                      name: name || address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
                      address: address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
                      lat: coords.lat,
                      lng: coords.lng,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold">
                  <MapPin className="w-4 h-4" /> Use this location
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
