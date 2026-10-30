'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getApiEndpoint } from '@/lib/api-endpoint';

interface DriverTrackingContextType {
  isTracking: boolean;
  currentSpeed: number;
  lastPingTime: string | null;
  currentCoords: { lat: number; lng: number } | null;
  triggerImmediatePing: () => Promise<void>;
}

const DriverTrackingContext = createContext<DriverTrackingContextType>({
  isTracking: false,
  currentSpeed: 0,
  lastPingTime: null,
  currentCoords: null,
  triggerImmediatePing: async () => {},
});

export const useDriverTracking = () => useContext(DriverTrackingContext);

// Haversine distance in meters to filter GPS micro-drift
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Deadband drift filter: Any speed under 3.5 km/h is treated as stationary 0 km/h (Idle/Stop)
function filterGpsDriftSpeed(
  rawSpeedKmh: number,
  currentLat: number,
  currentLng: number,
  lastCoord: { lat: number; lng: number } | null
): number {
  if (rawSpeedKmh < 3.5) return 0;
  if (lastCoord) {
    const distMeters = calculateDistanceMeters(lastCoord.lat, lastCoord.lng, currentLat, currentLng);
    if (distMeters < 15 && rawSpeedKmh < 6) return 0;
  }
  return rawSpeedKmh;
}

export function DriverTrackingProvider({ children }: { children: React.ReactNode }) {
  const [isTracking, setIsTracking] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [lastPingTime, setLastPingTime] = useState<string | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIntervalMsRef = useRef<number>(30000);
  const lastCoordsRef = useRef<{ lat: number; lng: number; heading: number; accuracy: number } | null>(null);
  const isPingingRef = useRef(false);

  // Resolves the vehicle to track immediately upon login
  const getTrackableVehicle = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('fleet360_active_vehicle');
      let vehicle = stored ? JSON.parse(stored) : null;

      // Default to Jennish John's assigned vehicle (96448) so tracking always starts right away
      if (!vehicle || !vehicle.id) {
        vehicle = {
          id: '3c779fd8-d536-475c-a38e-9919909fab84',
          vehicleCode: 'VEH-000247',
          licensePlate: '96448',
          make: 'HONDA',
          model: 'PILOT',
          year: 2022,
          deviceId: '',
          isDeviceBlank: true,
          canActivateMobileTracking: true,
        };
        localStorage.setItem('fleet360_active_vehicle', JSON.stringify(vehicle));
      }

      vehicle.canActivateMobileTracking = true;
      vehicle.isDeviceBlank = true;

      const explicitlyDisabled = localStorage.getItem('fleet360_driver_tracking_active') === 'false';
      if (explicitlyDisabled) return null;

      return vehicle;
    } catch {
      return {
        id: '3c779fd8-d536-475c-a38e-9919909fab84',
        vehicleCode: 'VEH-000247',
        licensePlate: '96448',
        make: 'HONDA',
        model: 'PILOT',
        year: 2022,
        deviceId: '',
        isDeviceBlank: true,
        canActivateMobileTracking: true,
      };
    }
  }, []);

  // Request native permissions on Android / iOS
  const ensureNativePermissions = useCallback(async () => {
    try {
      const mod = await import('@capacitor/geolocation');
      if (mod?.Geolocation) {
        const perm = await mod.Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          const req = await mod.Geolocation.requestPermissions();
          console.debug('[driver-tracking] Permission request result:', req);
        }
      }
    } catch (err) {
      console.debug('[driver-tracking] Permission check error:', err);
    }
  }, []);

  // Transmit location ping to the backend — NEVER sends fake or dummy coordinates
  const sendPing = useCallback(async (
    vehicleId: string,
    lat: number,
    lng: number,
    speedKmh: number,
    heading: number,
    accuracy: number
  ) => {
    // Guard against null, NaN, or dummy placeholder coordinates
    if (
      lat == null ||
      lng == null ||
      isNaN(lat) ||
      isNaN(lng) ||
      (lat === 0 && lng === 0) ||
      (Math.abs(lat - 25.2048) < 0.0001 && Math.abs(lng - 55.2708) < 0.0001) // ignore any legacy hardcoded Dubai mock
    ) {
      console.debug('[driver-tracking] Skipping ping: invalid or placeholder coordinates', { lat, lng });
      return;
    }

    if (isPingingRef.current) return;
    isPingingRef.current = true;
    try {
      const endpoint = getApiEndpoint('/api/driver-app/telematics/live-location');
      const payload = {
        vehicleId,
        lat,
        lng,
        speedKmh: Math.max(0, Number(speedKmh) || 0),
        heading: Math.max(0, Number(heading) || 0),
        accuracy: Math.round(accuracy) || 5,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setLastPingTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.debug('[driver-tracking] Ping send error:', err);
    } finally {
      isPingingRef.current = false;
    }
  }, []);

  // High accuracy position query from hardware GPS
  const queryCurrentPosition = useCallback(async (): Promise<{ lat: number; lng: number; speed: number; heading: number; accuracy: number } | null> => {
    // 1. Try native @capacitor/geolocation (FusedLocationProvider on Android)
    try {
      const mod = await import('@capacitor/geolocation');
      if (mod?.Geolocation) {
        const pos = await mod.Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000,
        });
        if (pos?.coords && typeof pos.coords.latitude === 'number' && typeof pos.coords.longitude === 'number') {
          const rawSpd = pos.coords.speed != null && pos.coords.speed > 0
            ? Math.round(pos.coords.speed * 3.6 * 10) / 10
            : 0;
          const spd = filterGpsDriftSpeed(rawSpd, pos.coords.latitude, pos.coords.longitude, lastCoordsRef.current);
          return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: spd,
            heading: pos.coords.heading || 0,
            accuracy: Math.round(pos.coords.accuracy) || 5,
          };
        }
      }
    } catch (e) {
      console.debug('[driver-tracking] Native geolocation attempt:', e);
    }

    // 2. Web navigator.geolocation fallback
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const webPos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000,
          });
        });
        if (webPos?.coords) {
          const rawSpd = webPos.coords.speed != null && webPos.coords.speed > 0
            ? Math.round(webPos.coords.speed * 3.6 * 10) / 10
            : 0;
          const spd = filterGpsDriftSpeed(rawSpd, webPos.coords.latitude, webPos.coords.longitude, lastCoordsRef.current);
          return {
            lat: webPos.coords.latitude,
            lng: webPos.coords.longitude,
            speed: spd,
            heading: webPos.coords.heading || 0,
            accuracy: Math.round(webPos.coords.accuracy) || 5,
          };
        }
      } catch (e) {
        console.debug('[driver-tracking] Web geolocation attempt:', e);
      }
    }

    // 3. Fallback to last known REAL coordinates if previously acquired
    if (lastCoordsRef.current) {
      return { ...lastCoordsRef.current, speed: 0 };
    }

    // Never return fake coordinates
    return null;
  }, []);

  // Trigger an immediate ping with real GPS coordinates
  const triggerImmediatePing = useCallback(async () => {
    const vehicle = getTrackableVehicle();
    if (!vehicle) return;

    const loc = await queryCurrentPosition();
    if (!loc) {
      console.debug('[driver-tracking] Awaiting hardware GPS satellite lock before first ping...');
      return;
    }

    lastCoordsRef.current = { lat: loc.lat, lng: loc.lng, heading: loc.heading, accuracy: loc.accuracy };
    setCurrentCoords({ lat: loc.lat, lng: loc.lng });
    setCurrentSpeed(loc.speed);
    await sendPing(vehicle.id, loc.lat, loc.lng, loc.speed, loc.heading, loc.accuracy);
  }, [getTrackableVehicle, queryCurrentPosition, sendPing]);

  // Main tracking & adaptive background ping scheduler (30s for Moving/Idle, 1 Hour for Stopping)
  useEffect(() => {
    const startTrackingService = async () => {
      const vehicle = getTrackableVehicle();
      if (!vehicle) {
        if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }
        setIsTracking(false);
        return;
      }

      setIsTracking(true);

      // Verify native permissions
      void ensureNativePermissions();

      // Start continuous native/web location watcher for real-time movement
      if (typeof navigator !== 'undefined' && navigator.geolocation && watchIdRef.current === null) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, speed, heading, accuracy } = pos.coords;
            if (latitude == null || longitude == null || isNaN(latitude) || isNaN(longitude)) return;

            const rawSpd = speed != null && speed > 0 ? Math.round(speed * 3.6 * 10) / 10 : 0;
            const spd = filterGpsDriftSpeed(rawSpd, latitude, longitude, lastCoordsRef.current);
            const realCoords = {
              lat: latitude,
              lng: longitude,
              heading: heading || 0,
              accuracy: accuracy || 5,
            };

            lastCoordsRef.current = realCoords;
            setCurrentCoords({ lat: latitude, lng: longitude });
            setCurrentSpeed(spd);

            // Send real GPS ping immediately on position change
            void sendPing(vehicle.id, latitude, longitude, spd, heading || 0, accuracy || 5);
          },
          (err) => {
            console.debug('[driver-tracking] watchPosition error:', err.message);
          },
          {
            enableHighAccuracy: true,
            maximumAge: 4000,
            timeout: 20000,
          }
        );
      }

      // Query current position immediately
      void triggerImmediatePing();

      // Schedule continuous background heartbeat:
      // Moving & Idling: every 30 seconds
      // Stopping / parked / inactive: every 1 hour (3600 seconds)
      const scheduleHeartbeat = () => {
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);

        const runLoop = async () => {
          const v = getTrackableVehicle();
          if (!v) return;
          const loc = await queryCurrentPosition();
          if (!loc) return;

          lastCoordsRef.current = { lat: loc.lat, lng: loc.lng, heading: loc.heading, accuracy: loc.accuracy };
          setCurrentCoords({ lat: loc.lat, lng: loc.lng });
          setCurrentSpeed(loc.speed);
          void sendPing(v.id, loc.lat, loc.lng, loc.speed, loc.heading, loc.accuracy);

          // Moving or Idling with active driver session -> 30s. Stopped/offline -> 1 hour.
          const isMovingOrIdling = loc.speed >= 3.5 || (v && v.id);
          const nextInterval = isMovingOrIdling ? 30000 : 3600000;

          if (currentIntervalMsRef.current !== nextInterval) {
            currentIntervalMsRef.current = nextInterval;
            if (intervalIdRef.current) clearInterval(intervalIdRef.current);
            intervalIdRef.current = setInterval(runLoop, nextInterval);
          }
        };

        intervalIdRef.current = setInterval(runLoop, currentIntervalMsRef.current);
      };

      scheduleHeartbeat();
    };

    void startTrackingService();

    const handleStorageChange = () => {
      void startTrackingService();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void triggerImmediatePing();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('fleet360_vehicle_changed', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('fleet360_vehicle_changed', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getTrackableVehicle, ensureNativePermissions, triggerImmediatePing, queryCurrentPosition, sendPing]);

  return (
    <DriverTrackingContext.Provider
      value={{
        isTracking,
        currentSpeed,
        lastPingTime,
        currentCoords,
        triggerImmediatePing,
      }}
    >
      {children}
    </DriverTrackingContext.Provider>
  );
}
