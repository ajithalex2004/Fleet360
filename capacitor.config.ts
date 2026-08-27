/**
 * Capacitor config for the Fleet360 driver mobile app.
 *
 * `webDir` is set to the Next.js production output (`out/` after `next build`).
 * For dev/iteration we use `npm run cap:sync:dev` which copies the current
 * `.next/standalone` build to a `out/` dir Capacitor can pick up. For the
 * first cut we ship the Capacitor scaffold but the actual native build is
 * documented in `docs/DRIVER_MOBILE_APP_ROADMAP.md` — you need Xcode (iOS)
 * and Android Studio to actually produce .ipa / .apk.
 *
 * `appId` MUST match a real bundle id you control (iOS + Play Store).
 * `webDir` is set to `out` because the actual `next build` output for a
 * static-export is in `./out`. We do NOT static-export the whole Next.js
 * app — that would break the admin dashboard. Only the driver-app route
 * group is mobile-built; the admin app stays a web app.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fleet360.driver',
  appName: 'Fleet360 Driver',
  webDir: 'out/driver',
  // The bundled WebView config. iOS + Android use the system WebView
  // (WKWebView on iOS 14+, Chromium on Android 9+) — no Cordova,
  // no embedded browser. Background colour matches the dark theme to
  // avoid a white flash on cold start.
  backgroundColor: '#0F172A',
  // Set `server.hostname` to something other than the default
  // `localhost`. This changes the WebView's main URL from
  // `https://localhost/` to `https://localhost2/`, which
  // invalidates any stale WebView HTTP cache (cache is keyed
  // on the full URL — a different host = cache miss).
  //
  // v10 note: this is now defense-in-depth, not the primary
  // cache-bust. The primary mechanism is
  // `WebView.clearCache(true)` called from MainActivity.onCreate
  // (see android/app/src/main/java/com/fleet360/driver/MainActivity.java).
  // clearCache wipes the WebView's HTTP cache + localStorage +
  // IndexedDB + Service Workers on every cold start, so the
  // launcher always loads fresh — even on MIUI where the system
  // WebView cache survives `pm clear` and uninstall+reinstall.
  server: {
    androidScheme: 'https',
    hostname: 'localhost2',
  },
  plugins: {
    // Camera — DVIR defect photos. We restrict to environment + photos
    // (no video) and prefer the system picker when possible (lighter
    // permission model than in-app capture).
    Camera: {
      // Limit to stills. No video.
      // (Plugin doesn't expose a direct flag; we enforce on the caller.)
    },
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0F172A',
      androidSplashResourceName: 'splash',
      iosContentMode: 'cover',
      showSpinner: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0F172A',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
