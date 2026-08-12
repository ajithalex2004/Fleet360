/**
 * tests/unit/gis-service-areas.test.ts
 *
 * Unit tests for the GIS demo data shape (lib/gis/serviceAreas.ts).
 *
 * These tests validate that the layer metadata + features are well-formed
 * (the GIS view layer relies on this for rendering). They are the kind of
 * cheap regression tests that catch accidental shape changes.
 */

import { describe, expect, it } from 'vitest';
import {
  GIS_LAYERS,
  GIS_DATA,
  type GisLayerId,
} from '@/lib/gis/serviceAreas';

const ALL_IDS: GisLayerId[] = ['routes', 'stops', 'serviceArea', 'demographics', 'traffic', 'landmarks'];

describe('gis serviceAreas — layer metadata', () => {
  it('defines all six expected layers', () => {
    expect(GIS_LAYERS).toHaveLength(6);
    expect(GIS_LAYERS.map((l) => l.id).sort()).toEqual([...ALL_IDS].sort());
  });

  it('every layer has a label, description, color, and defaultVisible flag', () => {
    for (const l of GIS_LAYERS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.description.length).toBeGreaterThan(0);
      expect(l.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof l.defaultVisible).toBe('boolean');
    }
  });

  it('defaultVisible distribution matches the UI', () => {
    const visible = GIS_LAYERS.filter((l) => l.defaultVisible).map((l) => l.id);
    // UI shows: routes, stops, serviceArea, traffic (4 of 6)
    expect(visible).toEqual(['routes', 'stops', 'serviceArea', 'traffic']);
  });
});

describe('gis serviceAreas — data shape', () => {
  it('routes have a non-empty polyline', () => {
    for (const r of GIS_DATA.routes) {
      expect(r.id).toBeTruthy();
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.coordinates.length).toBeGreaterThan(1);
      // Each coordinate is [lat, lng] with valid ranges
      for (const [lat, lng] of r.coordinates) {
        expect(lat).toBeGreaterThan(20);
        expect(lat).toBeLessThan(30);
        expect(lng).toBeGreaterThan(50);
        expect(lng).toBeLessThan(60);
      }
    }
  });

  it('stops have valid lat/lng and at least some are linked to a route', () => {
    for (const s of GIS_DATA.stops) {
      expect(s.id).toBeTruthy();
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.lat).toBeGreaterThan(20);
      expect(s.lat).toBeLessThan(30);
      expect(s.lng).toBeGreaterThan(50);
      expect(s.lng).toBeLessThan(60);
    }
    const linked = GIS_DATA.stops.filter((s) => s.routeId);
    expect(linked.length).toBeGreaterThan(0);
  });

  it('service areas are closed polygons (first vertex = last vertex)', () => {
    for (const sa of GIS_DATA.serviceArea) {
      expect(sa.density).toBeGreaterThanOrEqual(0);
      expect(sa.density).toBeLessThanOrEqual(100);
      expect(sa.ring.length).toBeGreaterThanOrEqual(4);
      const first = sa.ring[0];
      const last = sa.ring[sa.ring.length - 1];
      expect(first[0]).toBeCloseTo(last[0], 5);
      expect(first[1]).toBeCloseTo(last[1], 5);
    }
  });

  it('landmarks have a valid category', () => {
    const valid = ['HOSPITAL', 'SCHOOL', 'MALL', 'TRANSIT', 'OFFICE_PARK'];
    for (const l of GIS_DATA.landmarks) {
      expect(valid).toContain(l.category);
    }
    // At least one of each
    for (const c of valid) {
      expect(GIS_DATA.landmarks.some((l) => l.category === c)).toBe(true);
    }
  });

  it('demographics heatmap is non-empty (Dubai is dense)', () => {
    expect(GIS_DATA.demographics.length).toBeGreaterThan(20);
  });
});
