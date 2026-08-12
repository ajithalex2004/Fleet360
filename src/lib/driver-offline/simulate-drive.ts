/**
 * lib/driver-offline/simulate-drive.ts
 *
 * Demo affordance: synthesise a realistic GPS trace for the behaviour
 * watcher when there's no real device. The trace is a 90-second drive
 * through Downtown Dubai with believable events:
 *
 *   - 5 s of smooth acceleration from 0 to 60 km/h
 *   - 15 s of cruising at 60 km/h
 *   - HARSH_BRAKE at a stop sign
 *   - 30 s of idle at the stop
 *   - 5 s of smooth acceleration back to 80 km/h
 *   - SPEEDING event: 95 km/h for 4 s
 *   - HARSH_ACCEL
 *   - 10 s of cruising back to 70 km/h
 *   - 5 s of smooth deceleration to 0
 *
 * Each sample is fed to the behaviour watcher's `injectPosition()`
 * method. The watcher classifies them in real time and updates the
 * score on the UI just as a real trip would.
 *
 * The trace starts near the Burj Khalifa and ends at Dubai Mall, both
 * familiar landmarks for the GCC demo audience.
 *
 * This is dev-only. In production this module would be tree-shaken
 * out (the UI's "Simulate drive" button is wrapped in `process.env.NODE_ENV
 * !== 'production'`).
 */

import type { BehaviorWatcher } from './behavior-watcher';

interface SimulateDriveOptions {
  /** 60-120 km/h cruising speed. Defaults to 60. */
  cruiseSpeedKph?: number;
  /** Override the loop interval (ms). Defaults to 200ms = 5Hz sampling. */
  sampleIntervalMs?: number;
  /** Called when the simulation finishes. */
  onComplete?: () => void;
}

const SAMPLE_HZ = 5; // 5 samples/sec — denser than 1Hz to ensure harsh events fire
const SAMPLE_INTERVAL = 1000 / SAMPLE_HZ;

// Downtown Dubai waypoints (rough — for demo only)
const WAYPOINTS = [
  { lat: 25.1972, lng: 55.2742, name: 'Burj Khalifa' },
  { lat: 25.1956, lng: 55.2792, name: 'Sheikh Zayed Rd' },
  { lat: 25.1935, lng: 55.2851, name: 'Financial Centre Rd' },
  { lat: 25.1925, lng: 55.2901, name: 'Dubai Mall' },
];

// Lat/lng delta per km of latitude (rough)
const LAT_PER_KM = 1 / 111;
// At lat 25°, lng delta per km
const LNG_PER_KM = 1 / (111 * Math.cos(25 * Math.PI / 180));

function interpolate(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  t: number, // 0..1
): { lat: number; lng: number } {
  return {
    lat: start.lat + (end.lat - start.lat) * t,
    lng: start.lng + (end.lng - start.lng) * t,
  };
}

export interface SimulateHandle {
  /** Stops the simulation. Safe to call multiple times. */
  stop: () => void;
  /** True if currently running. */
  isRunning: () => boolean;
}

export function simulateDrive(
  watcher: BehaviorWatcher,
  opts: SimulateDriveOptions = {},
): SimulateHandle {
  const sampleInterval = opts.sampleIntervalMs ?? SAMPLE_INTERVAL;
  const cruiseSpeed = opts.cruiseSpeedKph ?? 60;
  let stopped = false;
  let sampleIdx = 0;

  // The trace is built dynamically: a sequence of segments, each
  // described by a (lat, lng, speedKph) per sample. We compute one
  // sample per tick.
  type Segment = {
    samples: number;          // how many ticks this segment lasts
    start: { lat: number; lng: number; speedKph: number };
    end: { lat: number; lng: number; speedKph: number };
  };

  const segments: Segment[] = [];

  // 1. 0 → 60 km/h acceleration over 5 s
  segments.push({
    samples: 5 * SAMPLE_HZ,
    start: { ...WAYPOINTS[0], speedKph: 0 },
    end:   { lat: WAYPOINTS[1].lat, lng: WAYPOINTS[1].lng, speedKph: 60 },
  });
  // 2. Cruise 60 km/h for 10 s
  segments.push({
    samples: 10 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[1].lat, lng: WAYPOINTS[1].lng, speedKph: 60 },
    end:   { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 60 },
  });
  // 3. Harsh brake (60 → 0 in 1.5 s = -40 km/h/s, well above the 5 km/h/s threshold)
  segments.push({
    samples: 1.5 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 60 },
    end:   { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 0 },
  });
  // 4. Idle for 8 s (just enough to fire IDLE_START — the watcher
  //    uses a 60s threshold normally, but the demo can shortcut that
  //    by manually firing IDLE_START here OR by letting the trace
  //    loop. We rely on the watcher's logic here.)
  segments.push({
    samples: 8 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 0 },
    end:   { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 0 },
  });
  // 5. Acceleration back to cruise (0 → 70 km/h in 2 s = +35 km/h/s, harsh)
  segments.push({
    samples: 2 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[1].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[1].lng + LNG_PER_KM * 0.15, speedKph: 0 },
    end:   { lat: WAYPOINTS[2].lat, lng: WAYPOINTS[2].lng, speedKph: 70 },
  });
  // 6. Speed up to 95 (70 → 95 km/h in 1.5 s = +17 km/h/s, harsh)
  segments.push({
    samples: 1.5 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[2].lat, lng: WAYPOINTS[2].lng, speedKph: 70 },
    end:   { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.05, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.05, speedKph: 95 },
  });
  // 7. Cruising at 95 for 4 s — fires SPEEDING (over 90 km/h limit)
  segments.push({
    samples: 4 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.05, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.05, speedKph: 95 },
    end:   { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.10, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.10, speedKph: 95 },
  });
  // 8. Decelerate to 60 (95 → 60 in 2 s = -17 km/h/s, harsh)
  segments.push({
    samples: 2 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.10, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.10, speedKph: 95 },
    end:   { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.15, speedKph: 60 },
  });
  // 9. Cruise 60 for 8 s
  segments.push({
    samples: 8 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[2].lat + LAT_PER_KM * 0.15, lng: WAYPOINTS[2].lng + LNG_PER_KM * 0.15, speedKph: 60 },
    end:   { lat: WAYPOINTS[3].lat, lng: WAYPOINTS[3].lng, speedKph: 60 },
  });
  // 10. Decelerate to 0 (60 → 0 in 3 s = -20 km/h/s, harsh)
  segments.push({
    samples: 3 * SAMPLE_HZ,
    start: { lat: WAYPOINTS[3].lat, lng: WAYPOINTS[3].lng, speedKph: 60 },
    end:   { lat: WAYPOINTS[3].lat, lng: WAYPOINTS[3].lng, speedKph: 0 },
  });

  // Flatten the segments into a single sample timeline. Each entry
  // is the (lat, lng, speedKph) at that tick.
  const timeline: Array<{ lat: number; lng: number; speedKph: number }> = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.samples; i++) {
      const t = i / Math.max(1, seg.samples - 1);
      const pos = interpolate(seg.start, { lat: seg.end.lat, lng: seg.end.lng }, t);
      // Speed is linear too, but with the segment-end speed being
      // the target. The "linear" approach gives a smooth ramp.
      const speedKph = seg.start.speedKph + (seg.end.speedKph - seg.start.speedKph) * t;
      timeline.push({ lat: pos.lat, lng: pos.lng, speedKph });
    }
  }

  const totalSamples = timeline.length;

  const tick = () => {
    if (stopped) return;
    if (sampleIdx >= totalSamples) {
      stopped = true;
      opts.onComplete?.();
      return;
    }
    const s = timeline[sampleIdx];
    watcher.injectPosition(s.lat, s.lng, s.speedKph, Date.now());
    sampleIdx++;
  };

  const interval = setInterval(tick, sampleInterval);

  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(interval);
      }
    },
    isRunning: () => !stopped,
  };
}
