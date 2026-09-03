import crypto from 'crypto';

export interface ColdChainTelemetryReading {
  timestamp: string;
  formattedTime: string;
  temperatureC: number;
  humidityPercent: number;
  doorStatus: 'CLOSED' | 'OPEN';
  compressorStatus: 'COOLING' | 'DEFROST' | 'STANDBY';
  powerSource: 'DIESEL' | 'ELECTRIC_STANDBY' | 'BATTERY';
  lat: number;
  lng: number;
  isBreach: boolean;
}

export interface TargetTemperatureBand {
  cargoType: string;
  minTempC: number;
  maxTempC: number;
  alertThresholdC: number;
  label: string;
}

export const COLD_CHAIN_TARGET_BANDS: Record<string, TargetTemperatureBand> = {
  FROZEN_PHARMA: {
    cargoType: 'Frozen Pharma & Vaccines',
    minTempC: -22.0,
    maxTempC: -16.0,
    alertThresholdC: -15.0,
    label: '-18°C Frozen Pharma (MOHAP/GDP)',
  },
  CHILLED_DAIRY: {
    cargoType: 'Chilled Food & Dairy',
    minTempC: 2.0,
    maxTempC: 6.0,
    alertThresholdC: 8.0,
    label: '+4°C Chilled Fresh Food (Dubai Foodwatch)',
  },
  AMBIENT_CONTROLLED: {
    cargoType: 'Controlled Room Temperature (CRT)',
    minTempC: 15.0,
    maxTempC: 25.0,
    alertThresholdC: 28.0,
    label: '+20°C CRT Ambient Controlled',
  },
};

export interface ColdChainTelemetryProfile {
  tripReference: string;
  vehiclePlate: string;
  sensorId: string;
  sensorBatteryPercent: number;
  targetBand: TargetTemperatureBand;
  readings: ColdChainTelemetryReading[];
  currentTempC: number;
  averageTempC: number;
  minTempC: number;
  maxTempC: number;
  breachMinutes: number;
  complianceScorePercent: number;
  gdpStatus: 'GDP_COMPLIANT' | 'WARNING_EXCURSION' | 'NON_COMPLIANT_REJECTED';
  certificateSeal: string;
}

/**
 * Generates continuous minute-by-minute realistic in-transit telemetry stream
 */
export function generateContinuousTelemetryStream(
  tripRef: string = 'TRIP-9821',
  bandKey: string = 'FROZEN_PHARMA',
  pointsCount: number = 24
): ColdChainTelemetryProfile {
  const targetBand = COLD_CHAIN_TARGET_BANDS[bandKey] || COLD_CHAIN_TARGET_BANDS.FROZEN_PHARMA;
  const readings: ColdChainTelemetryReading[] = [];
  const now = Date.now();

  let temp = targetBand.minTempC + (targetBand.maxTempC - targetBand.minTempC) / 2; // start mid-band
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let sumTemp = 0;
  let breachCount = 0;

  for (let i = pointsCount - 1; i >= 0; i--) {
    const time = new Date(now - i * 3 * 60000); // 3-minute intervals

    // Simulate minor highway refrigeration oscillation (-0.3 to +0.3)
    const delta = (Math.random() - 0.48) * 0.4;
    temp = Math.round((temp + delta) * 10) / 10;

    // Simulate a brief door open spike around point #18
    let doorStatus: 'CLOSED' | 'OPEN' = 'CLOSED';
    let compressorStatus: 'COOLING' | 'DEFROST' | 'STANDBY' = 'COOLING';

    if (i === 6) {
      // 18 mins ago: loading dock door opened for check
      doorStatus = 'OPEN';
      temp += 1.2;
    } else if (i === 5) {
      compressorStatus = 'COOLING';
      temp -= 0.8;
    }

    const isBreach = temp > targetBand.alertThresholdC;
    if (isBreach) breachCount++;

    minTemp = Math.min(minTemp, temp);
    maxTemp = Math.max(maxTemp, temp);
    sumTemp += temp;

    readings.push({
      timestamp: time.toISOString(),
      formattedTime: time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      temperatureC: temp,
      humidityPercent: Math.round(58 + Math.random() * 8),
      doorStatus,
      compressorStatus,
      powerSource: 'DIESEL',
      lat: 25.1972 + (Math.random() - 0.5) * 0.05,
      lng: 55.2744 + (Math.random() - 0.5) * 0.05,
      isBreach,
    });
  }

  const averageTempC = Math.round((sumTemp / pointsCount) * 10) / 10;
  const complianceScorePercent = Math.round(((pointsCount - breachCount) / pointsCount) * 1000) / 10;
  const gdpStatus =
    complianceScorePercent >= 95
      ? 'GDP_COMPLIANT'
      : complianceScorePercent >= 80
      ? 'WARNING_EXCURSION'
      : 'NON_COMPLIANT_REJECTED';

  const sealData = JSON.stringify({
    tripRef,
    sensorId: 'BLE-EYE-REEFER-94821',
    averageTempC,
    minTemp,
    maxTemp,
    gdpStatus,
    timestamp: new Date().toISOString(),
  });
  const certificateSeal = crypto.createHash('sha256').update(sealData).digest('hex');

  return {
    tripReference: tripRef,
    vehiclePlate: 'DXB-K-94821 (3-Ton ThermoKing Reefer)',
    sensorId: 'BLE-EYE-REEFER-94821',
    sensorBatteryPercent: 94,
    targetBand,
    readings,
    currentTempC: readings[readings.length - 1].temperatureC,
    averageTempC,
    minTempC: minTemp,
    maxTempC: maxTemp,
    breachMinutes: breachCount * 3,
    complianceScorePercent,
    gdpStatus,
    certificateSeal,
  };
}
