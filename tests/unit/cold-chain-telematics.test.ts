import { describe, it, expect } from 'vitest';
import {
  generateContinuousTelemetryStream,
  COLD_CHAIN_TARGET_BANDS,
} from '@/lib/cold-chain-telematics';

describe('Live IoT Cold-Chain Telematics & Continuous Temperature Engine', () => {
  it('generates continuous minute-by-minute in-transit telemetry readings with door and compressor states', () => {
    const stream = generateContinuousTelemetryStream('TRIP-9821', 'FROZEN_PHARMA', 20);

    expect(stream.readings.length).toBe(20);
    expect(stream.tripReference).toBe('TRIP-9821');
    expect(stream.vehiclePlate).toContain('3-Ton ThermoKing Reefer');
    expect(stream.sensorId).toBe('BLE-EYE-REEFER-94821');
    expect(stream.sensorBatteryPercent).toBeGreaterThan(90);

    // Verify readings data structure
    for (const pt of stream.readings) {
      expect(pt.temperatureC).toBeDefined();
      expect(pt.humidityPercent).toBeGreaterThan(0);
      expect(['CLOSED', 'OPEN']).toContain(pt.doorStatus);
      expect(['COOLING', 'DEFROST', 'STANDBY']).toContain(pt.compressorStatus);
      expect(pt.powerSource).toBe('DIESEL');
    }
  });

  it('calculates average in-transit temperature and GDP compliance quality score', () => {
    const stream = generateContinuousTelemetryStream('TRIP-9821', 'FROZEN_PHARMA', 24);

    expect(stream.averageTempC).toBeLessThan(-15);
    expect(stream.minTempC).toBeLessThan(stream.maxTempC);
    expect(stream.complianceScorePercent).toBeGreaterThanOrEqual(80);
    expect(['GDP_COMPLIANT', 'WARNING_EXCURSION']).toContain(stream.gdpStatus);
    expect(stream.certificateSeal).toHaveLength(64); // SHA-256
  });

  it('supports multiple cold-chain target categories (Frozen Pharma, Chilled Food, Ambient CRT)', () => {
    const frozen = COLD_CHAIN_TARGET_BANDS.FROZEN_PHARMA;
    const chilled = COLD_CHAIN_TARGET_BANDS.CHILLED_DAIRY;
    const ambient = COLD_CHAIN_TARGET_BANDS.AMBIENT_CONTROLLED;

    expect(frozen.minTempC).toBe(-22.0);
    expect(frozen.alertThresholdC).toBe(-15.0);

    expect(chilled.minTempC).toBe(2.0);
    expect(chilled.alertThresholdC).toBe(8.0);

    expect(ambient.minTempC).toBe(15.0);
    expect(ambient.alertThresholdC).toBe(28.0);
  });
});
