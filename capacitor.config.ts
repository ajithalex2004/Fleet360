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
  backgroundColor: '#0F172A',
  server: {
    androidScheme: 'https',
    hostname: 'localhost2',
    cleartext: true,
  },
  plugins: {
    Camera: {},
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
    // Foreground Location Service (@capacitor-community/background-geolocation)
    // Keeps GPS & geofence telemetry running when the screen is locked or when
    // Google Maps / Waze is in the foreground during container drayage trips.
    BackgroundGeolocation: {
      notificationTitle: 'Fleet360 Active Dispatch Telemetry',
      notificationText: 'Uninterrupted GPS & geofence tracking active in background',
      distanceFilter: 25,
      stopOnTerminate: false,
      startOnBoot: true,
    },
    // Over-The-Air (OTA) Live Updates (@capgo/capacitor-updater)
    // Deploys UI and workflow updates over-the-air without requiring manual APK reinstalls.
    CapacitorUpdater: {
      autoUpdate: true,
      resetWhenUpdate: false,
      updateUrl: 'https://fleet360-app-production.up.railway.app/api/driver-app/ota-manifest',
      statsUrl: '',
      channelUrl: '',
      allowModifyUrl: true,
    },
  },
};

export default config;
