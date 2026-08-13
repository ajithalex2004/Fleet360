/**
 * src/lib/driver-offline/capacitor.ts
 *
 * Lazy imports for the Capacitor plugins. We do NOT import them at
 * the top of the file because:
 *   1. Capacitor modules only exist inside the Capacitor runtime
 *      (the native app). Importing them in a plain Next.js web build
 *      throws at build time. We need the import to be dynamic.
 *   2. Server-side rendering has no `window` / `navigator` and
 *      Capacitor's modules are not safe to import there.
 *
 * The pattern below: each helper returns the plugin (if loaded) or
 * null (if we're in a plain browser, or on the server). The caller
 * checks the return and falls back to a web-API equivalent.
 *
 * In the Capacitor build these resolve to real native plugins:
 *   - Camera  → native iOS UIImagePickerController / Android Intent
 *   - Network → native connectivity (no polling like navigator.onLine)
 *   - App     → app lifecycle (foreground / background / url events)
 *   - Geolocation → native high-accuracy GPS with background modes
 *
 * In the web dev build these resolve to null and the fallbacks fire.
 */

let _camera: any = null;
let _network: any = null;
let _app: any = null;
let _geo: any = null;
let _capabilityProbed = false;

async function isCapacitor(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // The Capacitor runtime injects a `Capacitor` global with a
  // `isNativePlatform()` method. We check this rather than the
  // presence of @capacitor/core because the core module is bundled
  // into the web build too — but the runtime global is only there
  // in the native shell.
  const w = window as any;
  return Boolean(w.Capacitor?.isNativePlatform?.());
}

async function tryImport(speccer: string): Promise<any> {
  try {
    return await import(/* @vite-ignore */ speccer);
  } catch {
    return null;
  }
}

async function probeCapabilities(): Promise<void> {
  if (_capabilityProbed) return;
  _capabilityProbed = true;
  if (!(await isCapacitor())) return;
  const [camera, network, app, geo] = await Promise.all([
    tryImport('@capacitor/camera'),
    tryImport('@capacitor/network'),
    tryImport('@capacitor/app'),
    tryImport('@capacitor/geolocation'),
  ]);
  _camera = camera;
  _network = network;
  _app = app;
  _geo = geo;
}

export async function getCamera(): Promise<any | null> {
  await probeCapabilities();
  return _camera;
}

export async function getNetwork(): Promise<any | null> {
  await probeCapabilities();
  return _network;
}

export async function getApp(): Promise<any | null> {
  await probeCapabilities();
  return _app;
}

export async function getGeolocation(): Promise<any | null> {
  await probeCapabilities();
  return _geo;
}

/** Convenience: high-accuracy current position, with native + browser
 *  fallback. Returns null if the user denies or the platform has no
 *  location capability. */
export async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  await probeCapabilities();
  if (_geo) {
    try {
      const perm = await _geo.Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await _geo.Geolocation.requestPermissions();
        if (req.location !== 'granted') return null;
      }
      const pos = await _geo.Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    } catch {
      return null;
    }
  }
  // Browser fallback
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }
  return null;
}
