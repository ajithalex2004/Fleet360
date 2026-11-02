/**
 * scripts/verify-corridor-live-map.ts
 *
 * Automated verification test for Option B:
 * Real-Time Telematics & Corridor Tracking Map.
 */

import { UAE_FREIGHT_CORRIDORS } from '../src/components/logistics/drayage/DrayageCorridorLiveMap';
import * as fs from 'fs';
import * as path from 'path';

function runVerifications() {
  console.log('=== STARTING OPTION B: CORRIDOR MAP & TELEMATICS VERIFICATION ===\n');

  // 1. Verify Freight Corridors
  console.log('1. Checking UAE Freight Corridors definitions...');
  console.log(`   Found ${UAE_FREIGHT_CORRIDORS.length} corridors defined.`);
  
  const expectedCodes = ['E11', 'E311', 'E611', 'D53', 'D57 / E77'];
  for (const exp of expectedCodes) {
    const found = UAE_FREIGHT_CORRIDORS.find(c => c.code.includes(exp.split(' ')[0]));
    if (!found) {
      throw new Error(`Corridor ${exp} missing from UAE_FREIGHT_CORRIDORS`);
    }
    console.log(`   ✓ Corridor ${found.code} (${found.name}): ${found.path.length} waypoints, speed limit ${found.speedLimitKmh} km/h`);

    // Verify all waypoints are in UAE geographic bounding box
    for (const pt of found.path) {
      if (pt.lat < 24.0 || pt.lat > 26.0 || pt.lng < 54.0 || pt.lng > 56.5) {
        throw new Error(`Waypoint out of bounds in ${found.code}: ${pt.lat}, ${pt.lng}`);
      }
    }
  }

  // 2. Verify DrayageCorridorLiveMap Component File
  console.log('\n2. Checking DrayageCorridorLiveMap.tsx component...');
  const mapPath = path.join(__dirname, '../src/components/logistics/drayage/DrayageCorridorLiveMap.tsx');
  const mapContent = fs.readFileSync(mapPath, 'utf-8');

  const requiredTokens = [
    'buildDrayageMarkerSvg',
    'buildPortTerminalMarkerSvg',
    'buildWarehouseMarkerSvg',
    'radarPulse',
    'bogieTetherMap',
    'flightpathPolylinesRef',
    'STREET-TURN',
    '2x20 BOGIE',
    'RAMP-DETACH',
    'infoWindowRef',
    'setMapTypeId',
  ];

  for (const token of requiredTokens) {
    if (!mapContent.includes(token)) {
      throw new Error(`DrayageCorridorLiveMap.tsx missing required implementation token: "${token}"`);
    }
    console.log(`   ✓ Verified feature token: "${token}"`);
  }

  // 3. Verify Drayage Job Tracking Page Integration
  console.log('\n3. Checking tracking/page.tsx integration...');
  const pagePath = path.join(__dirname, '../src/app/(app)/logistics/drayage/tracking/page.tsx');
  const pageContent = fs.readFileSync(pagePath, 'utf-8');

  const pageTokens = [
    'DrayageCorridorLiveMap',
    'viewMode',
    'SPLIT',
    'RADAR',
    'CONSOLE',
    'On Freight Corridors (E11/E311)',
    'Dual-20FT Bogie Dispatches',
    'Street-Turn Triangulations',
    'Detached at Warehouse Ramps',
    'Port PCS / Gate Clearance',
    'fullHeight={viewMode === \'RADAR\'}',
  ];

  for (const token of pageTokens) {
    if (!pageContent.includes(token)) {
      throw new Error(`tracking/page.tsx missing required integration token: "${token}"`);
    }
    console.log(`   ✓ Verified page integration token: "${token}"`);
  }

  // 4. Verify Google Maps Loader Polyline Interface
  console.log('\n4. Checking google-maps-loader.ts enhancements...');
  const loaderPath = path.join(__dirname, '../src/lib/google-maps-loader.ts');
  const loaderContent = fs.readFileSync(loaderPath, 'utf-8');
  if (!loaderContent.includes('addListener(event: string, cb: (e?: any) => void): void;')) {
    throw new Error('google-maps-loader.ts missing Polyline addListener interface');
  }
  console.log('   ✓ Verified GMapsPolyline.addListener typing.');

  console.log('\n=== ALL OPTION B REAL-TIME TELEMATICS & CORRIDOR MAP VERIFICATIONS PASSED SUCCESSFULLY! ===');
}

runVerifications();
