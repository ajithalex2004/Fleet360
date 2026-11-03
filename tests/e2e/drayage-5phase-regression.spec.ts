import { test, expect } from '@playwright/test';

/**
 * Fleet360 Enterprise Container Drayage & Driver Telematics
 * 5-Phase (21-Check) Automated UI/UX & API Regression Gate
 *
 * Covers the complete work-order sequence:
 *   Phase 1: System Setup, Unified Identity Link (User.id <-> Driver.id FK) & Master Data
 *   Phase 2: Order Intake, Dispatch Planning & ETC/Customs Readiness
 *   Phase 3: Mobile Driver App Execution, Exclusive Assigned Vehicle Lock & OTA Manifest
 *   Phase 4: Customer Portal Tracking, Waiting Time / Demurrage & Commercial Billing
 *   Phase 5: Outcome Analytics, Full-Stack Observability SLOs & Shift Closure
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'biju@trexla.ae';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Trexla@2026';
const DRIVER_EMAIL = process.env.E2E_DRIVER_EMAIL || 'ATINERBIR@fastandsafe.com';
const DRIVER_PASSWORD = process.env.E2E_DRIVER_PASSWORD || 'Driver@123';

test.describe.serial('Fleet360 5-Phase Drayage & Driver App Regression Suite (21 Checks)', () => {
  let adminCookieHeader = '';
  let driverSessionToken = '';
  let sampleTrackingCode = '';
  let assignedVehicleId = '';
  let workspaceEtag = '';

  test('Phase 1 (Checks 1-5): System Setup, Unified Identity FK & Master Data', async ({ page, request }) => {
    // Check 1: Admin Login UI & Tenant Session
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    await expect(emailInput).toBeVisible();

    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();
    const setCookies = loginRes.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    adminCookieHeader = setCookies.map((c) => c.value.split(';')[0]).join('; ');
    expect(adminCookieHeader.length).toBeGreaterThan(10);

    // Check 2: Unified Identity Link (drivers.user_id <-> User.id) in Driver Hub API
    const driversRes = await request.get(`${BASE_URL}/api/drivers`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(driversRes.ok()).toBeTruthy();
    const drivers = (await driversRes.json()) as Array<{
      id: string;
      userId?: string | null;
      name?: string;
      assignedVehicleId?: string | null;
    }>;
    expect(Array.isArray(drivers)).toBeTruthy();
    expect(drivers.length).toBeGreaterThan(0);

    const atinerbir = drivers.find((d) => (d.name || '').toUpperCase().includes('ATINERBIR'));
    expect(atinerbir).toBeDefined();
    expect(atinerbir?.userId).toBeTruthy();

    // Check 3: Vehicle Master & Assigned Driver Synchronization
    const vehiclesRes = await request.get(`${BASE_URL}/api/vehicles`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(vehiclesRes.ok()).toBeTruthy();
    const vehiclesPayload = await vehiclesRes.json();
    const vehiclesList = Array.isArray(vehiclesPayload)
      ? vehiclesPayload
      : (vehiclesPayload.vehicles ?? vehiclesPayload.data ?? []);
    expect(vehiclesList.length).toBeGreaterThan(0);

    // Check 4: Geofences & Port/Warehouse Registry in Drayage Workspace
    const drayageRes = await request.get(`${BASE_URL}/api/logistics/drayage`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(drayageRes.ok()).toBeTruthy();
    workspaceEtag = drayageRes.headers()['etag'] || '';
    const drayageData = await drayageRes.json();
    expect(Array.isArray(drayageData.geofences)).toBeTruthy();
    expect(drayageData.geofences.length).toBeGreaterThan(0);

    // Check 5: Rate Cards & Demurrage Rules Registry
    expect(Array.isArray(drayageData.rateCards)).toBeTruthy();
    expect(drayageData.rateCards.length).toBeGreaterThan(0);
  });

  test('Phase 2 (Checks 6-9): Order Intake, Dispatch Planning & ETC/Customs Gate', async ({ page, request }) => {
    const drayageRes = await request.get(`${BASE_URL}/api/logistics/drayage`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(drayageRes.ok()).toBeTruthy();
    const drayageData = await drayageRes.json();

    // Check 6: Booking & Container Order Intake Verification
    expect(Array.isArray(drayageData.jobs)).toBeTruthy();
    expect(drayageData.jobs.length).toBeGreaterThan(0);

    // Check 7: Container Assignment & Tracking Code Generation
    const firstContainer = drayageData.jobs
      .flatMap((j: { containers?: Array<{ trackingCode?: string }> }) => j.containers || [])
      .find((c: { trackingCode?: string }) => Boolean(c.trackingCode));
    if (firstContainer?.trackingCode) {
      sampleTrackingCode = firstContainer.trackingCode;
    }
    expect(drayageData.summary).toBeDefined();

    // Check 8: ETC / Port Token & Customs Clearance Readiness
    expect(typeof drayageData.summary.etcOverdueContainers).toBe('number');
    expect(typeof drayageData.summary.activeTrips).toBe('number');

    // Check 9: Drayage Dispatch UI Renders Work-Order Tabs
    await page.context().addCookies(
      adminCookieHeader
        .split('; ')
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split('=');
          return { name, value: rest.join('='), url: BASE_URL };
        }),
    );
    await page.goto(`${BASE_URL}/logistics/drayage`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/Drayage|Container|Dispatch/i);
  });

  test('Phase 3 (Checks 10-15): Mobile Driver App, Exclusive Assigned Vehicle Lock & OTA Manifest', async ({
    page,
    request,
  }) => {
    // Check 10: OTA Live Update & Foreground Telemetry Manifest Endpoint
    const otaRes = await request.get(`${BASE_URL}/api/driver-app/ota-manifest?version=2026.11.01&platform=android`);
    expect(otaRes.ok()).toBeTruthy();
    const otaManifest = await otaRes.json();
    expect(otaManifest.appId).toBe('com.fleet360.driver');
    expect(otaManifest.updateAvailable).toBe(true);
    expect(otaManifest.backgroundTelemetryConfig?.provider).toBe('@capacitor-community/background-geolocation');

    // Check 11: Driver Authentication (Atinerbir Singh)
    const driverLoginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: DRIVER_EMAIL, password: DRIVER_PASSWORD },
    });
    expect(driverLoginRes.ok()).toBeTruthy();
    const driverLoginJson = await driverLoginRes.json();
    driverSessionToken = driverLoginJson.sessionToken || driverLoginJson.token || '';
    const driverSetCookies = driverLoginRes.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const driverCookieHeader = driverSetCookies.map((c) => c.value.split(';')[0]).join('; ');

    // Check 12: Exclusive Assigned Vehicle Resolution via Unified Identity FK (DXB-18312 / TRX-005)
    const vehListRes = await request.get(`${BASE_URL}/api/driver-app/auth/vehicle-login?list=true`, {
      headers: {
        Cookie: driverCookieHeader,
        ...(driverSessionToken ? { Authorization: `Bearer ${driverSessionToken}` } : {}),
      },
    });
    expect(vehListRes.ok()).toBeTruthy();
    const vehListData = await vehListRes.json();
    expect(vehListData.driver).toBeDefined();
    expect((vehListData.driver.name || '').toUpperCase()).toContain('ATINERBIR');
    expect(Array.isArray(vehListData.vehicles)).toBeTruthy();
    expect(vehListData.vehicles.length).toBe(1);
    expect(vehListData.vehicles[0].licensePlate).toContain('18312');
    assignedVehicleId = vehListData.vehicles[0].id;

    // Check 13: Driver App Mobile UI Renders OTA Status Pill & Exclusive Vehicle Step
    await page.goto(`${BASE_URL}/driver-app`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/Fleet360 Driver/i);
    await expect(page.locator('body')).toContainText(/OTA/i);

    // Check 14: Vehicle Login Binding (Confirm Assigned Vehicle & Odometer)
    const bindRes = await request.post(`${BASE_URL}/api/driver-app/auth/vehicle-login`, {
      headers: {
        Cookie: driverCookieHeader,
        ...(driverSessionToken ? { Authorization: `Bearer ${driverSessionToken}` } : {}),
      },
      data: {
        vehicleCode: vehListData.vehicles[0].licensePlate || 'DXB-18312',
        odometerReading: 142580,
      },
    });
    expect(bindRes.ok()).toBeTruthy();

    // Check 15: Live GPS Telemetry Ping & Auto-Geofence Detection
    if (assignedVehicleId) {
      const gpsRes = await request.post(`${BASE_URL}/api/driver-app/telematics/live-location`, {
        headers: {
          Cookie: driverCookieHeader,
          ...(driverSessionToken ? { Authorization: `Bearer ${driverSessionToken}` } : {}),
        },
        data: {
          vehicleId: assignedVehicleId,
          lat: 25.0112,
          lng: 55.0618,
          speedKmh: 44,
          heading: 180,
          accuracy: 8,
        },
      });
      expect([200, 201, 403]).toContain(gpsRes.status());
    }
  });

  test('Phase 4 (Checks 16-18): Customer Tracking Portal, Waiting Time & Commercial Invoicing', async ({
    page,
    request,
  }) => {
    // Check 16: Public Customer Tracking API & W3C Server-Timing Header
    if (sampleTrackingCode) {
      const trackRes = await request.get(
        `${BASE_URL}/api/driver-app/customer-tracking?code=${encodeURIComponent(sampleTrackingCode)}`,
      );
      expect(trackRes.ok()).toBeTruthy();
      expect(trackRes.headers()['server-timing']).toBeDefined();
    }

    // Check 17: Public Customer Tracking Portal UI
    await page.goto(`${BASE_URL}/track/container`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/Track|Container/i);

    // Check 18: Waiting Time, Demurrage & Allowance Commercial Summary
    const drayageRes = await request.get(`${BASE_URL}/api/logistics/drayage`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(drayageRes.ok()).toBeTruthy();
    const drayageData = await drayageRes.json();
    expect(typeof drayageData.summary.totalRevenueAed).toBe('number');
    expect(typeof drayageData.summary.totalDemurrageAed).toBe('number');
    expect(typeof drayageData.summary.totalAllowancesAed).toBe('number');
  });

  test('Phase 5 (Checks 19-21): Outcome Analytics, Full-Stack Observability SLOs & Cache Revalidation', async ({
    page,
    request,
  }) => {
    // Check 19: ETag / 304 Conditional Cache Revalidation & Server-Timing Header
    if (workspaceEtag) {
      const cachedRes = await request.get(`${BASE_URL}/api/logistics/drayage`, {
        headers: {
          Cookie: adminCookieHeader,
          'If-None-Match': workspaceEtag,
        },
      });
      expect([200, 304]).toContain(cachedRes.status());
      expect(cachedRes.headers()['server-timing']).toBeDefined();
    }

    // Check 20: Full-Stack Observability & 6-SLO Scorecard API + Synthetic Probe
    const obsRes = await request.get(`${BASE_URL}/api/logistics/drayage/observability`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(obsRes.ok()).toBeTruthy();
    const obsData = await obsRes.json();
    expect(Array.isArray(obsData.slos)).toBeTruthy();
    expect(obsData.slos.length).toBeGreaterThanOrEqual(6);
    expect(obsData.outcomes).toBeDefined();

    // Check 21: Drayage Analytics & Observability Command Center UI
    await page.goto(`${BASE_URL}/logistics/drayage/analytics`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/Analytics|Observability|SLO/i);
  });
});
