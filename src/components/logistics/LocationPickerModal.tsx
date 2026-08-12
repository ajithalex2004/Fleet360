'use client';
/**
 * LocationPickerModal — pick a point on a Mapbox map and return
 * { name, address, lat, lng }. Loads Mapbox GL JS from CDN (same pattern as
 * ShipmentTrackingMap — no npm dependency). Provides a forward-geocode search
 * box plus a draggable / click-to-move pin; the marker position is reverse-
 * geocoded to an address via the Mapbox Geocoding REST API (v5).
 *
 * Renders nothing when NEXT_PUBLIC_MAPBOX_TOKEN is unset (the caller's text
 * fields still work for manual entry).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, MapPin, Search, X } from 'lucide-react';

// ── Minimal CDN-global typings (reach the global via cast, like ShipmentTrackingMap) ──
interface MapboxMap {
  on(event: string, cb: (e: { lngLat: { lng: number; lat: number } }) => void): void;
  addControl(control: object, position?: string): void;
  flyTo(opts: object): void;
  remove(): void;
}
interface MapboxMarker {
  setLngLat(coords: [number, number]): MapboxMarker;
  addTo(map: MapboxMap): MapboxMarker;
  on(event: string, cb: () => void): MapboxMarker;
  getLngLat(): { lng: number; lat: number };
  remove(): MapboxMarker;
}
interface MapboxGL {
  accessToken: string;
  Map: new (opts: object) => MapboxMap;
  Marker: new (opts?: object) => MapboxMarker;
  NavigationControl: new (opts?: object) => object;
}
function gl(): MapboxGL | null {
  return (window as unknown as { mapboxgl?: MapboxGL }).mapboxgl ?? null;
}

const MAPBOX_CDN_VERSION = '3.3.0';
function loadMapboxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gl()) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.css`;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

interface GeoFeature { text?: string; place_name?: string; center?: [number, number]; }

export interface PickedLocation { name: string; address: string; lat: number; lng: number; }

const UAE_CENTER: [number, number] = [55.2708, 25.2048]; // Dubai

export default function LocationPickerModal({
  open, title, initial, onClose, onPick,
}: {
  open: boolean;
  title: string;
  initial?: { lat: number; lng: number; label?: string } | null;
  onClose: () => void;
  onPick: (loc: PickedLocation) => void;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);

  const [coords, setCoords] = useState<[number, number] | null>(initial ? [initial.lng, initial.lat] : null);
  const [name, setName] = useState(initial?.label ?? '');
  const [address, setAddress] = useState(initial?.label ?? '');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [results, setResults] = useState<GeoFeature[]>([]);

  // Reverse-geocode a point into a place name + full address.
  const reverseGeocode = useCallback(async (lng: number, lat: number) => {
    if (!token) return;
    setGeocoding(true);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1&language=en`;
      const json = await (await fetch(url)).json();
      const f: GeoFeature | undefined = json?.features?.[0];
      if (f) { setName(f.text ?? f.place_name ?? ''); setAddress(f.place_name ?? ''); }
      else { setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`); }
    } catch {
      setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setGeocoding(false);
    }
  }, [token]);

  // Drop / move the pin and reverse-geocode it.
  const place = useCallback((lng: number, lat: number) => {
    setCoords([lng, lat]);
    const mb = gl();
    const map = mapRef.current;
    if (mb && map) {
      if (!markerRef.current) {
        const mk = new mb.Marker({ draggable: true, color: '#f59e0b' }).setLngLat([lng, lat]).addTo(map);
        mk.on('dragend', () => { const ll = mk.getLngLat(); setCoords([ll.lng, ll.lat]); void reverseGeocode(ll.lng, ll.lat); });
        markerRef.current = mk;
      } else {
        markerRef.current.setLngLat([lng, lat]);
      }
    }
    void reverseGeocode(lng, lat);
  }, [reverseGeocode]);

  // Initialise the map once the modal is open and Mapbox is loaded.
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    loadMapboxScript().then(() => {
      const mb = gl();
      if (cancelled || !containerRef.current || mapRef.current || !mb) return;
      mb.accessToken = token;
      const start = coords ?? UAE_CENTER;
      const map = new mb.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/streets-v12', center: start, zoom: coords ? 13 : 9 });
      mapRef.current = map;
      map.addControl(new mb.NavigationControl(), 'top-right');
      map.on('click', (e) => { if (e?.lngLat) place(e.lngLat.lng, e.lngLat.lat); });
      if (coords) place(coords[0], coords[1]);
    }).catch(() => { /* token / network — picker degrades to manual entry */ });
    return () => {
      cancelled = true;
      markerRef.current?.remove(); markerRef.current = null;
      mapRef.current?.remove(); mapRef.current = null;
    };
    // Init once per open; coords/place are seeded from `initial` and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  // Forward-geocode the search box.
  const runSearch = useCallback(async () => {
    if (!token || !query.trim()) return;
    setSearching(true);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&limit=5&language=en&country=AE&proximity=${UAE_CENTER[0]},${UAE_CENTER[1]}`;
      const json = await (await fetch(url)).json();
      setResults(Array.isArray(json?.features) ? json.features : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [token, query]);

  const chooseResult = (r: GeoFeature) => {
    setResults([]);
    if (r.place_name) setQuery(r.place_name);
    if (r.center) {
      const [lng, lat] = r.center;
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 14 });
      place(lng, lat);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white"><MapPin className="h-5 w-5 text-amber-300" /> {title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {!token ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Map unavailable — <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> is not configured. Type the address manually in the form instead.
            <div className="mt-3 flex justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Close</button></div>
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
                    placeholder="Search a place or address…"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-amber-500/40"
                  />
                </div>
                <button type="button" onClick={() => void runSearch()} disabled={searching} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">{searching ? '…' : 'Search'}</button>
              </div>
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl">
                  {results.map((r, i) => (
                    <button type="button" key={i} onClick={() => chooseResult(r)} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
                      <span className="text-white">{r.text}</span><span className="text-slate-500"> — {r.place_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div ref={containerRef} className="h-80 w-full overflow-hidden rounded-xl border border-white/10" />

            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Crosshair className="h-3.5 w-3.5" /> Click the map or drag the pin to set the exact point.</p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Place name</span>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" /></label>
              <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Address {geocoding && <span className="text-slate-600">· locating…</span>}</span>
                <input value={address} onChange={e => setAddress(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" /></label>
            </div>
            {coords && <p className="mt-1 text-[11px] text-slate-500">Lat {coords[1].toFixed(5)}, Lng {coords[0].toFixed(5)}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
              <button type="button" disabled={!coords} onClick={() => coords && onPick({ name: name || address, address, lat: coords[1], lng: coords[0] })}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"><MapPin className="h-4 w-4" /> Use this location</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
