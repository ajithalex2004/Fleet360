/**
 * src/lib/telematics/location-resolver.ts
 *
 * Fast reverse-geocoding, landmark/district resolution, and geofence boundary matching
 * for live fleet telematics and real-time monitoring across Abu Dhabi, Dubai, Sharjah, and Northern Emirates.
 */

export interface AreaCenter {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isGeofenceZone?: boolean;
}

export const KNOWN_AREAS: AreaCenter[] = [
  // ── ABU DHABI CAPITAL & METROPOLITAN REGION ───────────────────────────────
  { name: 'Abu Dhabi City (Al Nahyan / Muroor)', lat: 24.4587, lng: 54.3838, radiusKm: 2.5, isGeofenceZone: true },
  { name: 'Abu Dhabi City (Al Wahda / Al Manhal)', lat: 24.4680, lng: 54.3720, radiusKm: 2.5, isGeofenceZone: true },
  { name: 'Abu Dhabi City (Al Karamah)', lat: 24.4610, lng: 54.3600, radiusKm: 2.0, isGeofenceZone: true },
  { name: 'Abu Dhabi City Center / Al Danah', lat: 24.4820, lng: 54.3570, radiusKm: 4.5, isGeofenceZone: true },
  { name: 'Abu Dhabi Corniche & Al Khalidiyah', lat: 24.4700, lng: 54.3350, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Al Reem Island, Abu Dhabi', lat: 24.4960, lng: 54.4020, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Al Maryah Island / ADGM, Abu Dhabi', lat: 24.5010, lng: 54.3890, radiusKm: 3.0, isGeofenceZone: true },
  { name: 'Al Bateen & Marina, Abu Dhabi', lat: 24.4450, lng: 54.3400, radiusKm: 3.5, isGeofenceZone: true },
  { name: 'Al Mushrif & Embassies Area, Abu Dhabi', lat: 24.4420, lng: 54.3980, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Mussafah Industrial Area, Abu Dhabi', lat: 24.3500, lng: 54.5000, radiusKm: 7.0, isGeofenceZone: true },
  { name: 'ICAD (Industrial City of Abu Dhabi)', lat: 24.3100, lng: 54.4600, radiusKm: 6.0, isGeofenceZone: true },
  { name: 'Zayed International Airport (AUH), Abu Dhabi', lat: 24.4440, lng: 54.6510, radiusKm: 6.5, isGeofenceZone: true },
  { name: 'Yas Island & Yas Marina, Abu Dhabi', lat: 24.4980, lng: 54.6050, radiusKm: 5.5, isGeofenceZone: true },
  { name: 'Saadiyat Island & Cultural District, Abu Dhabi', lat: 24.5380, lng: 54.4340, radiusKm: 5.5, isGeofenceZone: true },
  { name: 'Khalifa City & Masdar City, Abu Dhabi', lat: 24.4250, lng: 54.6150, radiusKm: 5.5, isGeofenceZone: true },
  { name: 'Mohamed Bin Zayed (MBZ) City, Abu Dhabi', lat: 24.3400, lng: 54.5500, radiusKm: 5.5, isGeofenceZone: true },
  { name: 'Al Raha Beach & Al Muneera, Abu Dhabi', lat: 24.4450, lng: 54.5750, radiusKm: 4.5, isGeofenceZone: true },
  { name: 'Baniyas & Al Shamkha, Abu Dhabi', lat: 24.3000, lng: 54.6400, radiusKm: 6.5, isGeofenceZone: true },
  { name: 'Al Maqta & Between Two Bridges, Abu Dhabi', lat: 24.4150, lng: 54.4950, radiusKm: 4.5, isGeofenceZone: true },
  { name: 'Khalifa Port & KIZAD / Taweelah, Abu Dhabi', lat: 24.8100, lng: 54.7200, radiusKm: 8.0, isGeofenceZone: true },
  { name: 'Al Shahama & Al Rahba, Abu Dhabi', lat: 24.5300, lng: 54.6900, radiusKm: 6.0, isGeofenceZone: true },
  { name: 'Al Ain City Center', lat: 24.2200, lng: 55.7600, radiusKm: 8.5, isGeofenceZone: true },
  { name: 'Al Dhafra / Madinat Zayed, Abu Dhabi', lat: 23.6500, lng: 53.7000, radiusKm: 15.0, isGeofenceZone: true },

  // ── DUBAI METROPOLITAN REGION ─────────────────────────────────────────────
  { name: 'Business Bay, Dubai', lat: 25.1855, lng: 55.2725, radiusKm: 3.5, isGeofenceZone: true },
  { name: 'Downtown / Burj Khalifa, Dubai', lat: 25.1972, lng: 55.2744, radiusKm: 2.5, isGeofenceZone: true },
  { name: 'Al Quoz Industrial 3, Dubai', lat: 25.1320, lng: 55.2350, radiusKm: 3.5, isGeofenceZone: true },
  { name: 'Al Quoz Industrial 1, Dubai', lat: 25.1550, lng: 55.2450, radiusKm: 2.5, isGeofenceZone: true },
  { name: 'Dubai Marina & JBR', lat: 25.0780, lng: 55.1390, radiusKm: 3.5, isGeofenceZone: true },
  { name: 'Jebel Ali Free Zone (JAFZA)', lat: 24.9950, lng: 55.0750, radiusKm: 6.0, isGeofenceZone: true },
  { name: 'Dubai International Airport (DXB)', lat: 25.2532, lng: 55.3657, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Deira / Port Saeed, Dubai', lat: 25.2650, lng: 55.3300, radiusKm: 3.0, isGeofenceZone: true },
  { name: 'Bur Dubai / Al Fahidi', lat: 25.2550, lng: 55.2950, radiusKm: 3.0, isGeofenceZone: true },
  { name: 'Dubai Silicon Oasis (DSO)', lat: 25.1180, lng: 55.3900, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Dubai Hills Estate / Al Barsha South', lat: 25.0950, lng: 55.2350, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Al Barsha 1, Dubai', lat: 25.1150, lng: 55.2050, radiusKm: 2.5, isGeofenceZone: true },
  { name: 'Dubai Investments Park (DIP)', lat: 24.9850, lng: 55.1800, radiusKm: 4.5, isGeofenceZone: true },

  // ── SHARJAH & NORTHERN EMIRATES ───────────────────────────────────────────
  { name: 'Sharjah Industrial Area', lat: 25.3120, lng: 55.4100, radiusKm: 5.0, isGeofenceZone: true },
  { name: 'Sharjah City Center / Al Majaz', lat: 25.3350, lng: 55.3850, radiusKm: 4.0, isGeofenceZone: true },
  { name: 'Ajman Industrial & City Center', lat: 25.4050, lng: 55.4550, radiusKm: 5.0, isGeofenceZone: true },
];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface ResolvedLocation {
  locationName: string;
  district: string;
  coordinatesFormatted: string;
  latitude: number;
  longitude: number;
  dateFormatted: string;
  timeFormatted: string;
  relativeFreshness: string;
  timestampIso: string;
  geofenceZone?: string | null;
  insideGeofence: boolean;
}

export function formatLocationFreshness(date: Date): string {
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 90) return '1m ago';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function checkGeofenceZone(lat: number, lng: number): { inside: boolean; zoneName: string | null } {
  for (const area of KNOWN_AREAS) {
    const dist = haversineKm(lat, lng, area.lat, area.lng);
    if (dist <= area.radiusKm) {
      return { inside: true, zoneName: area.name };
    }
  }
  return { inside: false, zoneName: null };
}

export function resolveLocation(
  lat: number | null | undefined,
  lng: number | null | undefined,
  occurredAt?: Date | string | null,
): ResolvedLocation | null {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
    return null;
  }

  const pingDate = occurredAt ? new Date(occurredAt) : new Date();
  const validDate = isNaN(pingDate.getTime()) ? new Date() : pingDate;

  // Format date & time
  const dateFormatted = validDate.toLocaleDateString('en-GB'); // "25/10/2026"
  const timeFormatted = validDate.toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }); // "07:15:30 PM"
  const relativeFreshness = formatLocationFreshness(validDate);
  const timestampIso = validDate.toISOString();

  const coordsFormatted = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;

  // Find nearest known district
  let nearestArea: AreaCenter | null = null;
  let minDistance = Infinity;

  for (const area of KNOWN_AREAS) {
    const dist = haversineKm(lat, lng, area.lat, area.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestArea = area;
    }
  }

  if (nearestArea && minDistance <= nearestArea.radiusKm) {
    return {
      locationName: nearestArea.name,
      district: nearestArea.name.split(',')[0].trim(),
      coordinatesFormatted: coordsFormatted,
      latitude: lat,
      longitude: lng,
      dateFormatted,
      timeFormatted,
      relativeFreshness,
      timestampIso,
      geofenceZone: null,
      insideGeofence: false,
    };
  }

  // Geographic corridor detection based on actual coordinates
  let regionName = 'UAE Region';

  // 1. Abu Dhabi Emirate (latitude 23.0 to 24.85, longitude 53.0 to 55.0)
  if (lat >= 23.0 && lat <= 24.85 && lng >= 53.0 && lng <= 55.0) {
    if (lat >= 24.5 && lng >= 54.6) {
      regionName = 'Sheikh Maktoum Bin Rashid Rd (E11), Abu Dhabi';
    } else if (lat >= 24.3 && lat <= 24.5 && lng >= 54.4 && lng <= 54.6) {
      regionName = 'Sheikh Zayed Bin Sultan St (E10), Abu Dhabi';
    } else if (lat >= 24.2 && lat <= 24.5 && lng >= 54.4 && lng <= 54.8) {
      regionName = 'Abu Dhabi Capital District';
    } else {
      regionName = 'Abu Dhabi Metropolitan Area';
    }
  }
  // 2. Dubai Emirate (latitude 24.85 to 25.35, longitude 55.0 to 55.5)
  else if (lat >= 24.85 && lat <= 25.35 && lng >= 55.0 && lng <= 55.5) {
    if (lng <= 55.18) {
      regionName = 'Sheikh Zayed Rd (E11), Dubai';
    } else if (lng <= 55.28) {
      regionName = 'Al Khail Rd (E44), Dubai';
    } else {
      regionName = 'Sheikh Mohammed Bin Zayed Rd (E311), Dubai';
    }
  }
  // 3. Sharjah / Northern Emirates
  else if (lat >= 25.25 && lat <= 25.6 && lng >= 55.35 && lng <= 56.0) {
    regionName = 'Sharjah - Northern Emirates Corridor';
  } else if (nearestArea) {
    regionName = `${nearestArea.name.split(',')[0].trim()} Vicinity`;
  }

  return {
    locationName: `${regionName} (${coordsFormatted})`,
    district: regionName,
    coordinatesFormatted: coordsFormatted,
    latitude: lat,
    longitude: lng,
    dateFormatted,
    timeFormatted,
    relativeFreshness,
    timestampIso,
    geofenceZone: null,
    insideGeofence: false,
  };
}
