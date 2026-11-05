'use client';

/**
 * Fleet360 Driver Native Bridge
 * -----------------------------
 * 1. Uninterrupted Background Geolocation (`@capacitor-community/background-geolocation`
 *    Android Foreground Service + Screen WakeLock + Offline Queue Flush + Web Fallback).
 *    Prevents Android OS from throttling GPS telemetry when the screen is locked or when
 *    Google Maps / Waze is in the foreground during active container drayage trips.
 *
 * 2. Over-The-Air (OTA) Live Updates (`@capgo/capacitor-updater` / `@capacitor/live-updates`
 *    + `/api/driver-app/ota-manifest` version synchronization).
 *    Allows UI and workflow updates to deploy over-the-air without requiring drivers
 *    to manually download and reinstall the `.apk`.
 */

export const LOCAL_OTA_BUNDLE_VERSION = '2026.11.09-ota.1';
const OFFLINE_GPS_QUEUE_KEY = 'fleet360_driver_offline_gps_queue_v1';
const LOCAL_OTA_STORAGE_KEY = 'fleet360_driver_ota_version';

export interface DriverGpsSample {
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  accuracyMeters: number | null;
  source: 'NATIVE_FOREGROUND_SERVICE' | 'WAKE_LOCK_WEB_WATCH' | 'BACKGROUND_HEARTBEAT';
  capturedAt: string;
}

export interface TelemetryWatcherHandle {
  mode: 'NATIVE_FOREGROUND_SERVICE' | 'WAKE_LOCK_WEB_WATCH';
  wakeLockActive: boolean;
  stop: () => Promise<void>;
}

export interface OtaSyncStatus {
  currentBundleVersion: string;
  installedBundleVersion: string;
  updateAvailable: boolean;
  otaApplied: boolean;
  nativeBridgeDetected: boolean;
  provider: 'CAPGO_UPDATER' | 'CAPACITOR_LIVE_UPDATES' | 'WEB_MANIFEST_SYNC';
  releaseNotes: string[];
  checkedAt: string;
}

interface CapacitorBackgroundLocation {
  latitude: number;
  longitude: number;
  speed?: number | null;
  bearing?: number | null;
  accuracy?: number | null;
  time?: number | null;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    BackgroundGeolocation?: {
      addWatcher: (
        options: {
          backgroundTitle: string;
          backgroundMessage: string;
          requestPermissions: boolean;
          stale: boolean;
          distanceFilter: number;
        },
        callback: (location?: CapacitorBackgroundLocation, error?: { code?: string; message?: string }) => void,
      ) => Promise<string>;
      removeWatcher: (options: { id: string }) => Promise<void>;
      openSettings?: () => Promise<void>;
    };
    CapacitorUpdater?: {
      notifyAppReady?: () => Promise<unknown>;
      current?: () => Promise<{ bundle?: { version?: string } }>;
      download?: (options: { url: string; version: string }) => Promise<{ id: string }>;
      set?: (options: { id: string }) => Promise<unknown>;
    };
    LiveUpdates?: {
      sync?: () => Promise<{ activeApplicationPathChanged?: boolean }>;
      reload?: () => Promise<void>;
    };
  };
}

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as { Capacitor?: CapacitorGlobal };
  return win.Capacitor ?? null;
}

export function isNativeCapacitorRuntime(): boolean {
  const cap = getCapacitor();
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Buffers a failed GPS ping when the driver enters a dead zone (port cranes, tunnel)
 * and flushes queued pings once network connectivity returns.
 */
export function enqueueOfflineGpsSample(sample: DriverGpsSample): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(OFFLINE_GPS_QUEUE_KEY);
    const list: DriverGpsSample[] = raw ? JSON.parse(raw) : [];
    list.push(sample);
    // Cap at 50 recent samples to bound localStorage usage
    const bounded = list.slice(-50);
    window.localStorage.setItem(OFFLINE_GPS_QUEUE_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore storage quota errors
  }
}

export function drainOfflineGpsSamples(): DriverGpsSample[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_GPS_QUEUE_KEY);
    if (!raw) return [];
    window.localStorage.removeItem(OFFLINE_GPS_QUEUE_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Starts a resilient GPS watcher that prioritizes `@capacitor-community/background-geolocation`
 * (Android Foreground Notification Service) so telemetry continues uninterrupted when the
 * screen is locked or Google Maps / Waze is in the foreground, with automatic fallback to
 * Screen WakeLock + `navigator.geolocation.watchPosition` + 15-second heartbeat.
 */
export async function startResilientDriverTelemetryWatcher(options: {
  onLocation: (sample: DriverGpsSample) => void | Promise<void>;
  distanceFilterMeters?: number;
  heartbeatIntervalMs?: number;
}): Promise<TelemetryWatcherHandle> {
  const distanceFilter = options.distanceFilterMeters ?? 25;
  const heartbeatMs = options.heartbeatIntervalMs ?? 15000;
  const cap = getCapacitor();
  const bgPlugin = cap?.Plugins?.BackgroundGeolocation;

  let wakeLockSentinel: { release: () => Promise<void> } | null = null;
  let wakeLockActive = false;

  const acquireWakeLock = async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      const navWithWake = navigator as unknown as {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (document.visibilityState === 'visible' && navWithWake.wakeLock) {
        wakeLockSentinel = await navWithWake.wakeLock.request('screen');
        wakeLockActive = true;
      }
    } catch {
      wakeLockActive = false;
    }
  };

  await acquireWakeLock();

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void acquireWakeLock();
    } else if ( typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      // Trigger an immediate one-shot position capture right as the app goes to background
      // (e.g. driver switches to Google Maps or Waze)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void options.onLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            speedKmh: pos.coords.speed && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : 0,
            heading: pos.coords.heading && pos.coords.heading >= 0 ? Math.round(pos.coords.heading) : 0,
            accuracyMeters: pos.coords.accuracy ?? null,
            source: 'BACKGROUND_HEARTBEAT',
            capturedAt: new Date().toISOString(),
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 },
      );
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // 1. Native Android/iOS Foreground Service Path (@capacitor-community/background-geolocation)
  if (bgPlugin && typeof bgPlugin.addWatcher === 'function') {
    try {
      const watcherId = await bgPlugin.addWatcher(
        {
          backgroundTitle: 'Fleet360 Active Dispatch Telemetry',
          backgroundMessage: 'Live GPS & geofence tracking active while navigating in Google Maps/Waze',
          requestPermissions: true,
          stale: false,
          distanceFilter,
        },
        (location, error) => {
          if (error || !location) return;
          void options.onLocation({
            latitude: location.latitude,
            longitude: location.longitude,
            speedKmh: location.speed && location.speed > 0 ? Math.round(location.speed * 3.6) : 0,
            heading: location.bearing && location.bearing >= 0 ? Math.round(location.bearing) : 0,
            accuracyMeters: location.accuracy ?? null,
            source: 'NATIVE_FOREGROUND_SERVICE',
            capturedAt: location.time ? new Date(location.time).toISOString() : new Date().toISOString(),
          });
        },
      );

      return {
        mode: 'NATIVE_FOREGROUND_SERVICE',
        wakeLockActive,
        stop: async () => {
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
          }
          if (wakeLockSentinel) {
            await wakeLockSentinel.release().catch(() => {});
          }
          await bgPlugin.removeWatcher({ id: watcherId }).catch(() => {});
        },
      };
    } catch {
      // Fall through to resilient web watcher if native permission/plugin init fails
    }
  }

  // 2. Resilient Web Geolocation Watcher + Background Heartbeat Polling
  let webWatchId: number | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        void options.onLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speedKmh: pos.coords.speed && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : 0,
          heading: pos.coords.heading && pos.coords.heading >= 0 ? Math.round(pos.coords.heading) : 0,
          accuracyMeters: pos.coords.accuracy ?? null,
          source: 'WAKE_LOCK_WEB_WATCH',
          capturedAt: new Date().toISOString(),
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 },
    );

    heartbeatTimer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void options.onLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            speedKmh: pos.coords.speed && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : 0,
            heading: pos.coords.heading && pos.coords.heading >= 0 ? Math.round(pos.coords.heading) : 0,
            accuracyMeters: pos.coords.accuracy ?? null,
            source: 'BACKGROUND_HEARTBEAT',
            capturedAt: new Date().toISOString(),
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 },
      );
    }, heartbeatMs);
  }

  return {
    mode: 'WAKE_LOCK_WEB_WATCH',
    wakeLockActive,
    stop: async () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (wakeLockSentinel) {
        await wakeLockSentinel.release().catch(() => {});
      }
      if (webWatchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(webWatchId);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    },
  };
}

/**
 * Checks `/api/driver-app/ota-manifest` and synchronizes Capgo / Capacitor Live Updates
 * so UI updates deploy over-the-air without requiring drivers to manually reinstall the `.apk`.
 */
export async function checkAndApplyDriverOtaLiveUpdate(apiBaseUrl = ''): Promise<OtaSyncStatus> {
  const cap = getCapacitor();
  const nativeBridgeDetected = Boolean(cap?.isNativePlatform?.());
  const capgoUpdater = cap?.Plugins?.CapacitorUpdater;
  const liveUpdates = cap?.Plugins?.LiveUpdates;

  let installedVersion = LOCAL_OTA_BUNDLE_VERSION;
  if (typeof window !== 'undefined') {
    installedVersion = window.localStorage.getItem(LOCAL_OTA_STORAGE_KEY) || LOCAL_OTA_BUNDLE_VERSION;
  }

  // Inform Capgo CapacitorUpdater that the current bundle booted cleanly (prevents automatic rollback)
  if (capgoUpdater?.notifyAppReady) {
    await capgoUpdater.notifyAppReady().catch(() => {});
  }

  const platform = cap?.getPlatform?.() || (nativeBridgeDetected ? 'android' : 'web');
  const url = `${apiBaseUrl}/api/driver-app/ota-manifest?version=${encodeURIComponent(installedVersion)}&platform=${encodeURIComponent(platform)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`OTA manifest returned ${res.status}`);
    }
    const manifest = (await res.json()) as {
      currentBundleVersion?: string;
      updateAvailable?: boolean;
      bundleUrl?: string;
      releaseNotes?: string[];
      checkedAt?: string;
    };

    const targetVersion = manifest.currentBundleVersion || LOCAL_OTA_BUNDLE_VERSION;
    const updateAvailable = Boolean(manifest.updateAvailable && targetVersion !== installedVersion);
    let otaApplied = false;
    let provider: OtaSyncStatus['provider'] = 'WEB_MANIFEST_SYNC';

    if (capgoUpdater) {
      provider = 'CAPGO_UPDATER';
      if (updateAvailable && manifest.bundleUrl && capgoUpdater.download && capgoUpdater.set) {
        const downloaded = await capgoUpdater.download({
          url: manifest.bundleUrl,
          version: targetVersion,
        });
        if (downloaded?.id) {
          await capgoUpdater.set({ id: downloaded.id });
          otaApplied = true;
        }
      }
    } else if (liveUpdates?.sync) {
      provider = 'CAPACITOR_LIVE_UPDATES';
      if (updateAvailable) {
        const syncResult = await liveUpdates.sync();
        otaApplied = Boolean(syncResult?.activeApplicationPathChanged);
      }
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCAL_OTA_STORAGE_KEY, targetVersion);
    }

    return {
      currentBundleVersion: targetVersion,
      installedBundleVersion: installedVersion,
      updateAvailable,
      otaApplied,
      nativeBridgeDetected,
      provider,
      releaseNotes: Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : [],
      checkedAt: manifest.checkedAt || new Date().toISOString(),
    };
  } catch {
    return {
      currentBundleVersion: LOCAL_OTA_BUNDLE_VERSION,
      installedBundleVersion: installedVersion,
      updateAvailable: false,
      otaApplied: false,
      nativeBridgeDetected,
      provider: capgoUpdater
        ? 'CAPGO_UPDATER'
        : liveUpdates
          ? 'CAPACITOR_LIVE_UPDATES'
          : 'WEB_MANIFEST_SYNC',
      releaseNotes: [],
      checkedAt: new Date().toISOString(),
    };
  }
}
