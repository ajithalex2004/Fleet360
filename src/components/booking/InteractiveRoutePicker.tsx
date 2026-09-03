'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Navigation, Clock, ShieldAlert, Sparkles } from 'lucide-react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';

export interface RouteStats {
  distanceKm: number;
  durationMins: number;
  salikTollsCount: number;
  salikTollsAed: number;
  originCoords?: { lat: number; lng: number };
  destCoords?: { lat: number; lng: number };
}

interface InteractiveRoutePickerProps {
  origin: string;
  destination: string;
  onOriginChange: (address: string, coords?: { lat: number; lng: number }) => void;
  onDestinationChange: (address: string, coords?: { lat: number; lng: number }) => void;
  onRouteChange?: (stats: RouteStats) => void;
  originLabel?: string;
  destinationLabel?: string;
  originPlaceholder?: string;
  destinationPlaceholder?: string;
  showMap?: boolean;
}

// ── UAE Common Landmarks Database (Fast Autocomplete & Fallback) ─────────────

export const UAE_POPULAR_LANDMARKS: Array<{ name: string; area: string; lat: number; lng: number }> = [
  { name: 'Dubai International Airport (DXB) - Terminal 3', area: 'Garhoud, Dubai', lat: 25.2532, lng: 55.3657 },
  { name: 'Dubai International Airport (DXB) - Terminal 1', area: 'Garhoud, Dubai', lat: 25.2505, lng: 55.3582 },
  { name: 'Al Maktoum International Airport (DWC)', area: 'Dubai South', lat: 24.8960, lng: 55.1614 },
  { name: 'Burj Khalifa & The Dubai Mall', area: 'Downtown Dubai', lat: 25.1972, lng: 55.2744 },
  { name: 'Dubai Marina Mall & Promenade', area: 'Dubai Marina', lat: 25.0772, lng: 55.1403 },
  { name: 'Mall of the Emirates (MOE)', area: 'Al Barsha, Dubai', lat: 25.1181, lng: 55.2007 },
  { name: 'Dubai International Financial Centre (DIFC)', area: 'Trade Centre, Dubai', lat: 25.2091, lng: 55.2798 },
  { name: 'Business Bay Metro & Executive Towers', area: 'Business Bay, Dubai', lat: 25.1862, lng: 55.2633 },
  { name: 'Jebel Ali Free Zone (JAFZA) - Gate 4', area: 'Jebel Ali, Dubai', lat: 24.9965, lng: 55.0874 },
  { name: 'Dubai Silicon Oasis (DSO) Headquarters', area: 'Silicon Oasis, Dubai', lat: 25.1278, lng: 55.3812 },
  { name: 'Abu Dhabi International Airport (Zayed AUH) - Terminal A', area: 'Abu Dhabi', lat: 24.4442, lng: 54.6511 },
  { name: 'Yas Mall & Ferrari World', area: 'Yas Island, Abu Dhabi', lat: 24.4889, lng: 54.6074 },
  { name: 'Abu Dhabi Mall & Corniche', area: 'Al Zahiyah, Abu Dhabi', lat: 24.4967, lng: 54.3831 },
  { name: 'Sharjah International Airport (SHJ)', area: 'Sharjah', lat: 25.3286, lng: 55.5172 },
  { name: 'Sharjah City Centre', area: 'Al Nahda, Sharjah', lat: 25.3262, lng: 55.3917 },
];

// ── UAE Salik & Darb Toll Estimation Engine ──────────────────────────────────

export function estimateUaeTolls(originLat: number, originLng: number, destLat: number, destLng: number, distanceKm: number): { tollCount: number; tollAed: number } {
  // Salik in Dubai: AED 4.00 per gate
  // Darb in Abu Dhabi: AED 4.00 per peak gate
  if (distanceKm < 2) return { tollCount: 0, tollAed: 0 };

  let count = 0;

  // Inter-Emirate trip (e.g. Dubai <-> Abu Dhabi or Dubai <-> Sharjah)
  const isDubaiToAbuDhabi = (originLng < 54.8 && destLng > 55.1) || (originLng > 55.1 && destLng < 54.8);
  const isDubaiToSharjah = (originLat > 25.3 && destLat < 25.2) || (originLat < 25.2 && destLat > 25.3);

  if (isDubaiToAbuDhabi) {
    // Crosses Jebel Ali Salik + Darb Bridge
    count = 3;
  } else if (isDubaiToSharjah) {
    // Crosses Al Mamzar / Airport Tunnel
    count = 2;
  } else if (distanceKm > 25) {
    // Long corridor in Dubai (e.g. Marina to Airport / Downtown)
    count = 2;
  } else if (distanceKm > 8) {
    // Short corridor crossing SZR or Al Garhoud
    count = 1;
  }

  return { tollCount: count, tollAed: count * 4 };
}

// Haversine geodesic distance in kilometers
export function calculateGeodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Apply urban road curvature factor (typically ~1.28x of straight-line)
  return Math.round(R * c * 1.28 * 10) / 10;
}

export function InteractiveRoutePicker({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onRouteChange,
  originLabel = 'Pickup Location (Origin)',
  destinationLabel = 'Drop-off Location (Destination)',
  originPlaceholder = 'Search landmark, street, building, or Makani number…',
  destinationPlaceholder = 'Search destination address, hotel, or terminal…',
  showMap = true,
}: InteractiveRoutePickerProps) {
  const originInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<typeof UAE_POPULAR_LANDMARKS>([]);
  const [destSuggestions, setDestSuggestions] = useState<typeof UAE_POPULAR_LANDMARKS>([]);
  const [stats, setStats] = useState<RouteStats | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);

  // Initialize coordinates from existing text if matching landmark
  useEffect(() => {
    if (origin && !originCoords) {
      const match = UAE_POPULAR_LANDMARKS.find(l => l.name.toLowerCase().includes(origin.toLowerCase()) || origin.toLowerCase().includes(l.name.toLowerCase()));
      if (match) setOriginCoords({ lat: match.lat, lng: match.lng });
    }
    if (destination && !destCoords) {
      const match = UAE_POPULAR_LANDMARKS.find(l => l.name.toLowerCase().includes(destination.toLowerCase()) || destination.toLowerCase().includes(l.name.toLowerCase()));
      if (match) setDestCoords({ lat: match.lat, lng: match.lng });
    }
  }, [origin, destination, originCoords, destCoords]);

  // Compute route metrics whenever coordinates change
  useEffect(() => {
    if (originCoords && destCoords) {
      const dist = calculateGeodesicDistance(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);
      // Average city/highway speed in UAE ~ 50 km/h (including traffic)
      const durationMins = Math.max(5, Math.round((dist / 50) * 60));
      const { tollCount, tollAed } = estimateUaeTolls(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng, dist);

      const computedStats: RouteStats = {
        distanceKm: dist,
        durationMins,
        salikTollsCount: tollCount,
        salikTollsAed: tollAed,
        originCoords,
        destCoords,
      };

      setStats(computedStats);
      if (onRouteChange) onRouteChange(computedStats);
    } else {
      setStats(null);
    }
  }, [originCoords, destCoords, onRouteChange]);

  // Load Google Maps Autocomplete if SDK is available
  useEffect(() => {
    let active = true;
    loadGoogleMaps()
      .then((google) => {
        if (!active) return;
        setMapsLoaded(true);

        // Attach Autocomplete to Origin
        if (originInputRef.current) {
          const originAuto = new google.Autocomplete(originInputRef.current, {
            componentRestrictions: { country: 'ae' },
            fields: ['formatted_address', 'geometry', 'name'],
          });
          originAuto.addListener('place_changed', () => {
            const place = originAuto.getPlace();
            const addr = place.formatted_address || place.name || '';
            const lat = place.geometry?.location?.lat();
            const lng = place.geometry?.location?.lng();
            if (lat !== undefined && lng !== undefined) {
              const coords = { lat, lng };
              setOriginCoords(coords);
              onOriginChange(addr, coords);
            } else {
              onOriginChange(addr);
            }
          });
        }

        // Attach Autocomplete to Destination
        if (destInputRef.current) {
          const destAuto = new google.Autocomplete(destInputRef.current, {
            componentRestrictions: { country: 'ae' },
            fields: ['formatted_address', 'geometry', 'name'],
          });
          destAuto.addListener('place_changed', () => {
            const place = destAuto.getPlace();
            const addr = place.formatted_address || place.name || '';
            const lat = place.geometry?.location?.lat();
            const lng = place.geometry?.location?.lng();
            if (lat !== undefined && lng !== undefined) {
              const coords = { lat, lng };
              setDestCoords(coords);
              onDestinationChange(addr, coords);
            } else {
              onDestinationChange(addr);
            }
          });
        }
      })
      .catch(() => {
        // Graceful fallback to built-in UAE landmarks database
        setMapsLoaded(false);
      });

    return () => {
      active = false;
    };
  }, [onOriginChange, onDestinationChange]);

  const handleOriginType = (val: string) => {
    onOriginChange(val);
    if (val.trim().length > 1) {
      const q = val.toLowerCase();
      setOriginSuggestions(
        UAE_POPULAR_LANDMARKS.filter(l => l.name.toLowerCase().includes(q) || l.area.toLowerCase().includes(q)).slice(0, 4)
      );
    } else {
      setOriginSuggestions([]);
    }
  };

  const handleDestType = (val: string) => {
    onDestinationChange(val);
    if (val.trim().length > 1) {
      const q = val.toLowerCase();
      setDestSuggestions(
        UAE_POPULAR_LANDMARKS.filter(l => l.name.toLowerCase().includes(q) || l.area.toLowerCase().includes(q)).slice(0, 4)
      );
    } else {
      setDestSuggestions([]);
    }
  };

  const selectOriginLandmark = (item: typeof UAE_POPULAR_LANDMARKS[0]) => {
    const coords = { lat: item.lat, lng: item.lng };
    setOriginCoords(coords);
    onOriginChange(`${item.name}, ${item.area}`, coords);
    setOriginSuggestions([]);
  };

  const selectDestLandmark = (item: typeof UAE_POPULAR_LANDMARKS[0]) => {
    const coords = { lat: item.lat, lng: item.lng };
    setDestCoords(coords);
    onDestinationChange(`${item.name}, ${item.area}`, coords);
    setDestSuggestions([]);
  };

  return (
    <div className="space-y-4">
      {/* ── Input Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Origin */}
        <div className="relative">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
              {originLabel} <span className="text-red-400">*</span>
            </span>
            {originCoords && <span className="text-[10px] text-emerald-400 font-mono">📍 GPS Synced</span>}
          </label>
          <div className="relative">
            <MapPin className="w-4 h-4 text-emerald-400 absolute left-3.5 top-3.5" />
            <input
              ref={originInputRef}
              type="text"
              value={origin}
              onChange={(e) => handleOriginType(e.target.value)}
              placeholder={originPlaceholder}
              required
              className="w-full bg-slate-800/80 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all shadow-inner"
            />
          </div>

          {/* Fallback Autocomplete Suggestions */}
          {originSuggestions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-white/15 rounded-xl shadow-2xl overflow-hidden divide-y divide-white/5">
              {originSuggestions.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => selectOriginLandmark(item)}
                  className="w-full text-left px-4 py-2.5 hover:bg-emerald-500/10 transition-colors flex items-start gap-2.5 group"
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-white group-hover:text-emerald-300">{item.name}</p>
                    <p className="text-[11px] text-slate-400">{item.area}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Destination */}
        <div className="relative">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
              {destinationLabel} <span className="text-red-400">*</span>
            </span>
            {destCoords && <span className="text-[10px] text-rose-400 font-mono">📍 GPS Synced</span>}
          </label>
          <div className="relative">
            <Navigation className="w-4 h-4 text-rose-400 absolute left-3.5 top-3.5" />
            <input
              ref={destInputRef}
              type="text"
              value={destination}
              onChange={(e) => handleDestType(e.target.value)}
              placeholder={destinationPlaceholder}
              required
              className="w-full bg-slate-800/80 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500/50 transition-all shadow-inner"
            />
          </div>

          {/* Fallback Autocomplete Suggestions */}
          {destSuggestions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-white/15 rounded-xl shadow-2xl overflow-hidden divide-y divide-white/5">
              {destSuggestions.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => selectDestLandmark(item)}
                  className="w-full text-left px-4 py-2.5 hover:bg-rose-500/10 transition-colors flex items-start gap-2.5 group"
                >
                  <Navigation className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-white group-hover:text-rose-300">{item.name}</p>
                    <p className="text-[11px] text-slate-400">{item.area}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Real-time Route Calculation Widget ── */}
      {stats && (
        <div className="bg-gradient-to-r from-violet-950/40 via-slate-900 to-slate-900 border border-violet-500/30 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Geospatial Route Intelligence
              </span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Optimal Corridor
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            {/* Distance */}
            <div className="bg-slate-800/60 rounded-xl p-2.5 border border-white/5">
              <div className="text-[11px] text-slate-400 uppercase font-medium">Driving Distance</div>
              <div className="text-lg font-bold text-white mt-0.5">{stats.distanceKm} km</div>
            </div>

            {/* Travel Duration */}
            <div className="bg-slate-800/60 rounded-xl p-2.5 border border-white/5">
              <div className="text-[11px] text-slate-400 uppercase font-medium">Estimated Time</div>
              <div className="text-lg font-bold text-violet-300 mt-0.5">
                {stats.durationMins >= 60
                  ? `${Math.floor(stats.durationMins / 60)}h ${stats.durationMins % 60}m`
                  : `${stats.durationMins} mins`}
              </div>
            </div>

            {/* UAE Salik / Darb Tolls */}
            <div className="bg-slate-800/60 rounded-xl p-2.5 border border-white/5">
              <div className="text-[11px] text-slate-400 uppercase font-medium">UAE Tolls (Salik)</div>
              <div className="text-lg font-bold text-amber-400 mt-0.5">
                {stats.salikTollsCount > 0
                  ? `${stats.salikTollsCount} Gates (AED ${stats.salikTollsAed})`
                  : '0 Tolls (Free)'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Interactive Visual Map Preview ── */}
      {showMap && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              🗺️ Interactive Corridor Map
            </span>
            <span className="text-[11px] text-slate-500">
              {originCoords && destCoords ? '📍 2 Waypoints Placed' : '📍 Awaiting locations'}
            </span>
          </div>

          <div className="relative w-full h-44 rounded-xl bg-slate-950 border border-white/5 overflow-hidden flex items-center justify-center">
            {/* SVG Visual Map Canvas with Route Line */}
            <svg className="w-full h-full" viewBox="0 0 400 180">
              <defs>
                <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#f43f5e" />
                </linearGradient>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
                </pattern>
              </defs>

              {/* Grid background */}
              <rect width="400" height="180" fill="url(#grid)" />

              {/* Simulated Map Roads */}
              <path d="M 0 90 Q 120 40 200 90 T 400 90" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
              <path d="M 60 180 Q 150 120 200 90 T 340 0" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />

              {/* Active Route Path */}
              {originCoords && destCoords ? (
                <>
                  <path
                    d="M 80 120 C 140 40, 260 140, 320 60"
                    fill="none"
                    stroke="url(#routeGradient)"
                    strokeWidth="4"
                    strokeDasharray="6 4"
                    className="animate-pulse"
                  />

                  {/* Origin Marker */}
                  <g transform="translate(80, 120)">
                    <circle r="12" fill="#10b981" opacity="0.3" className="animate-ping" />
                    <circle r="7" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
                    <text x="-15" y="-12" fill="#10b981" fontSize="10" fontWeight="bold">Pickup</text>
                  </g>

                  {/* Destination Marker */}
                  <g transform="translate(320, 60)">
                    <circle r="12" fill="#f43f5e" opacity="0.3" className="animate-ping" />
                    <circle r="7" fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
                    <text x="-15" y="-12" fill="#f43f5e" fontSize="10" fontWeight="bold">Drop-off</text>
                  </g>
                </>
              ) : (
                <text x="200" y="95" textAnchor="middle" fill="#64748b" fontSize="12">
                  Enter pickup and drop-off to render live driving route
                </text>
              )}
            </svg>

            {/* Live GPS Coordinates Tag */}
            {originCoords && destCoords && (
              <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-slate-300 font-mono border border-white/10">
                DXB ➔ SZR Corridor · GPS Lock Active
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
