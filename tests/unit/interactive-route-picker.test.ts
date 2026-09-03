import { describe, it, expect } from 'vitest';
import {
  calculateGeodesicDistance,
  estimateUaeTolls,
  UAE_POPULAR_LANDMARKS,
} from '@/components/booking/InteractiveRoutePicker';

describe('Geospatial Intelligence & Interactive Route Engine', () => {
  it('contains verified UAE major landmarks across Dubai, Abu Dhabi, and Sharjah', () => {
    expect(UAE_POPULAR_LANDMARKS.length).toBeGreaterThanOrEqual(10);

    const dxbAirport = UAE_POPULAR_LANDMARKS.find((l) => l.name.includes('DXB'));
    expect(dxbAirport).toBeDefined();
    expect(dxbAirport?.lat).toBeCloseTo(25.25, 1);
    expect(dxbAirport?.lng).toBeCloseTo(55.36, 1);

    const burjKhalifa = UAE_POPULAR_LANDMARKS.find((l) => l.name.includes('Burj Khalifa'));
    expect(burjKhalifa).toBeDefined();

    const auhAirport = UAE_POPULAR_LANDMARKS.find((l) => l.name.includes('AUH'));
    expect(auhAirport).toBeDefined();
    expect(auhAirport?.lat).toBeCloseTo(24.44, 1);
  });

  it('calculates accurate road-factored geodesic distance between coordinates', () => {
    // DXB Airport to Burj Khalifa (~14-16 km by road)
    const distDxbToBurj = calculateGeodesicDistance(25.2532, 55.3657, 25.1972, 55.2744);
    expect(distDxbToBurj).toBeGreaterThanOrEqual(12);
    expect(distDxbToBurj).toBeLessThanOrEqual(20);

    // Dubai to Abu Dhabi (~120-150 km by road)
    const distDubaiToAuh = calculateGeodesicDistance(25.1972, 55.2744, 24.4967, 54.3831);
    expect(distDubaiToAuh).toBeGreaterThanOrEqual(120);
    expect(distDubaiToAuh).toBeLessThanOrEqual(180);
  });

  it('accurately estimates UAE Salik & Darb toll gates for inter-emirate and city corridors', () => {
    // 1. Very short neighborhood trip (<2 km) -> 0 tolls
    const shortTrip = estimateUaeTolls(25.20, 55.27, 25.21, 55.27, 1.5);
    expect(shortTrip.tollCount).toBe(0);
    expect(shortTrip.tollAed).toBe(0);

    // 2. Dubai to Abu Dhabi trip -> 3 toll gates (Salik Jebel Ali + Darb Bridge gates = AED 12)
    const dxbToAuh = estimateUaeTolls(25.20, 55.27, 24.45, 54.65, 130);
    expect(dxbToAuh.tollCount).toBe(3);
    expect(dxbToAuh.tollAed).toBe(12);

    // 3. Dubai to Sharjah trip -> 2 toll gates (Al Mamzar / Airport Tunnel = AED 8)
    const dxbToShj = estimateUaeTolls(25.19, 55.27, 25.33, 55.51, 28);
    expect(dxbToShj.tollCount).toBe(2);
    expect(dxbToShj.tollAed).toBe(8);

    // 4. Moderate city corridor in Dubai (e.g. SZR ~15km) -> 1 toll gate = AED 4
    const cityTrip = estimateUaeTolls(25.25, 55.36, 25.19, 55.27, 15);
    expect(cityTrip.tollCount).toBe(1);
    expect(cityTrip.tollAed).toBe(4);
  });
});
