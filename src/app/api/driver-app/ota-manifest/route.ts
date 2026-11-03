import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const DRIVER_OTA_BUNDLE_VERSION =
  process.env.DRIVER_OTA_BUNDLE_VERSION || '2026.11.08-ota.1';
export const DRIVER_MIN_NATIVE_APK_VERSION =
  process.env.DRIVER_MIN_NATIVE_APK_VERSION || '1.4.0';

/**
 * GET /api/driver-app/ota-manifest
 *
 * Over-The-Air (OTA) Live Update & Foreground Telemetry Manifest for the
 * Fleet360 Driver Android/iOS Capacitor application.
 *
 * Consumed by `src/lib/driver-native-bridge.ts` on app launch and resume to:
 * 1. Synchronize Capacitor Live Updates / Capgo web bundles without requiring
 *    drivers to manually reinstall the `.apk`.
 * 2. Configure the `@capacitor-community/background-geolocation` foreground
 *    notification service parameters dynamically per deployment.
 */
export async function GET(req: NextRequest) {
  const clientVersion = req.nextUrl.searchParams.get('version') || 'unknown';
  const platform = req.nextUrl.searchParams.get('platform') || 'web';
  const origin = req.nextUrl.origin;

  const updateAvailable =
    clientVersion !== 'unknown' && clientVersion !== DRIVER_OTA_BUNDLE_VERSION;

  return NextResponse.json(
    {
      appId: 'com.fleet360.driver',
      channel: 'production',
      platform,
      clientVersion,
      currentBundleVersion: DRIVER_OTA_BUNDLE_VERSION,
      minNativeApkVersion: DRIVER_MIN_NATIVE_APK_VERSION,
      updateAvailable,
      mandatory: false,
      bundleUrl: `${origin}/driver-app?ota=${encodeURIComponent(DRIVER_OTA_BUNDLE_VERSION)}`,
      apkDownloadUrl: `${origin}/api/driver-app/ota-manifest?download=apk-info`,
      backgroundTelemetryConfig: {
        provider: '@capacitor-community/background-geolocation',
        distanceFilterMeters: 25,
        heartbeatIntervalMs: 15000,
        stationaryRadiusMeters: 20,
        stopOnTerminate: false,
        startOnBoot: true,
        foregroundService: {
          notificationTitle: 'Fleet360 Active Dispatch Telemetry',
          notificationBody: 'Uninterrupted GPS & geofence tracking active while navigating',
          notificationChannelId: 'fleet360_driver_telemetry_fg',
          notificationChannelName: 'Fleet360 Foreground Location Service',
        },
      },
      releaseNotes: [
        'Unified Identity Link (User.id <-> Driver.id FK) with O(1) vehicle-login resolution',
        'Android Foreground Service background geolocation bridge for locked-screen & Google Maps/Waze navigation',
        'Over-The-Air (OTA) Live Update synchronization without manual APK reinstall',
      ],
      checkedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
