/**
 * tests/unit/telematics-gateway-ingest.test.ts
 *
 * Unit tests for Telematics Gateway Webhook Ingestion Engine (Pattern A).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTelemetryPacket,
  normalizeTelemetryBatch,
} from '@/lib/telematics/gateway-ingest';

describe('Telematics Gateway Payload Normalizer (Pattern A)', () => {
  it('correctly normalizes a Flespi JSON webhook packet', () => {
    const rawFlespi = {
      ident: '864201047281920',
      timestamp: 1725177600, // Unix seconds
      'position.latitude': 25.0418,
      'position.longitude': 55.1402,
      'position.speed': 72.4,
      'position.direction': 145,
      'position.altitude': 18,
      'position.satellites': 15,
      'engine.ignition.status': true,
      'can.vehicle.mileage': 148200,
      'can.fuel.level': 78,
      'battery.voltage': 24.2,
      'can.engine.rpm': 1750,
      'can.engine.coolant.temperature': 88,
    };

    const normalized = normalizeTelemetryPacket(rawFlespi);
    expect(normalized).not.toBeNull();
    expect(normalized?.imei).toBe('864201047281920');
    expect(normalized?.latitude).toBe(25.0418);
    expect(normalized?.longitude).toBe(55.1402);
    expect(normalized?.speedKmh).toBe(72.4);
    expect(normalized?.headingDeg).toBe(145);
    expect(normalized?.altitudeM).toBe(18);
    expect(normalized?.satellites).toBe(15);
    expect(normalized?.ignition).toBe(true);
    expect(normalized?.odometerKm).toBe(148200);
    expect(normalized?.fuelLevelPercent).toBe(78);
    expect(normalized?.batteryVoltage).toBe(24.2);
    expect(normalized?.engineRpm).toBe(1750);
    expect(normalized?.coolantTempC).toBe(88);
  });

  it('correctly normalizes a Teltonika JSON packet with nested io attributes', () => {
    const rawTeltonika = {
      imei: '358912098471625',
      timestamp: '2026-09-01T10:15:30.000Z',
      lat: 25.1025,
      lng: 55.1984,
      speed: 85,
      angle: 270,
      altitude: 22,
      io: {
        ignition: 1,
        odometer: 89450,
        fuel: 65,
        battery_voltage: 12.8,
        sos: 1, // SOS Panic Triggered
        harsh_braking: 1,
      },
    };

    const normalized = normalizeTelemetryPacket(rawTeltonika);
    expect(normalized).not.toBeNull();
    expect(normalized?.imei).toBe('358912098471625');
    expect(normalized?.latitude).toBe(25.1025);
    expect(normalized?.longitude).toBe(55.1984);
    expect(normalized?.speedKmh).toBe(85);
    expect(normalized?.headingDeg).toBe(270);
    expect(normalized?.ignition).toBe(true);
    expect(normalized?.odometerKm).toBe(89450);
    expect(normalized?.fuelLevelPercent).toBe(65);
    expect(normalized?.batteryVoltage).toBe(12.8);
    expect(normalized?.sosPanic).toBe(true);
    expect(normalized?.harshBraking).toBe(true);
  });

  it('correctly normalizes a Traccar JSON forwarder packet', () => {
    const rawTraccar = {
      deviceId: '869012345678901',
      fixTime: '2026-09-01T08:00:00.000Z',
      latitude: 24.9812,
      longitude: 55.0841,
      speed: 52.3,
      course: 90,
      attributes: {
        ignition: true,
        odometer: 112400000, // In meters -> converted to km
        fuelLevel: 84,
      },
    };

    const normalized = normalizeTelemetryPacket(rawTraccar);
    expect(normalized).not.toBeNull();
    expect(normalized?.imei).toBe('869012345678901');
    expect(normalized?.latitude).toBe(24.9812);
    expect(normalized?.longitude).toBe(55.0841);
    expect(normalized?.speedKmh).toBe(52.3);
    expect(normalized?.headingDeg).toBe(90);
    expect(normalized?.ignition).toBe(true);
    expect(normalized?.odometerKm).toBe(112400); // meters to km conversion
    expect(normalized?.fuelLevelPercent).toBe(84);
  });

  it('correctly parses batch packets wrapped in array or records object', () => {
    const batchPayload = [
      {
        ident: 'IMEI-001',
        timestamp: 1725177600,
        lat: 25.1,
        lng: 55.2,
        speed: 40,
      },
      {
        ident: 'IMEI-002',
        timestamp: 1725177600,
        lat: 25.2,
        lng: 55.3,
        speed: 60,
      },
      {
        // Invalid packet without coordinates
        ident: 'IMEI-003',
        speed: 0,
      },
    ];

    const pings = normalizeTelemetryBatch(batchPayload);
    expect(pings.length).toBe(2);
    expect(pings[0].imei).toBe('IMEI-001');
    expect(pings[1].imei).toBe('IMEI-002');
  });

  it('rejects invalid or zero coordinates gracefully', () => {
    expect(normalizeTelemetryPacket({ imei: '12345', lat: 0, lng: 0 })).toBeNull();
    expect(normalizeTelemetryPacket({ imei: '', lat: 25.1, lng: 55.1 })).toBeNull();
    expect(normalizeTelemetryPacket(null as any)).toBeNull();
  });
});
