/**
 * Abu Dhabi ITC Asateel Telematics Gateway & Compliance Engine
 * Implements Abu Dhabi Integrated Transport Centre (ITC) commercial transport tracking specifications
 * and cross-emirate dispatch compliance gating (AUH Asateel + DXB RTA).
 */

export type AsateelPlateSource = 'AUH' | 'DXB' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ';
export type AsateelVehicleCategory = 'BUS_STAFF' | 'BUS_SCHOOL' | 'HEAVY_TRUCK' | 'LIGHT_TRUCK' | 'RECOVERY' | 'RENTAL';

export interface AsateelTelemetryPing {
  companyRegistrationNo: string; // ITC Operator ID
  vehiclePlate: string;
  plateSource: AsateelPlateSource;
  plateColor?: string;
  vin: string;
  gpsDeviceImei: string;
  driverEmiratesId: string; // 784-YYYY-NNNNNNN-C
  latitude: number;
  longitude: number;
  speedKmh: number;
  headingDeg: number;
  altitudeM?: number;
  ignition: boolean;
  odometerKm: number;
  fuelLevelPct?: number;
  timestamp: string; // ISO 8601 UTC
  alarmCode?: 'NORMAL' | 'OVERSPEED' | 'HARSH_BRAKE' | 'TAMPER' | 'SOS' | 'POWER_CUT';
}

export interface AsateelPayloadOutput {
  itcStandardVersion: string; // '2.4'
  authHeader: string;
  record: {
    CompanyId: string;
    PlateNo: string;
    PlateSource: string;
    ChassisNo: string;
    DeviceId: string;
    DriverCivilId: string;
    GPS: {
      Lat: number;
      Lng: number;
      Speed: number;
      Heading: number;
      Alt: number;
      FixTimeUtc: string;
    };
    Telemetry: {
      Ignition: number; // 1 = ON, 0 = OFF
      Odometer: number;
      FuelLevel: number;
      Alarm: string;
    };
  };
}

export interface AsateelGatingCheck {
  vehicleId: string;
  plateNumber: string;
  plateEmirate: AsateelPlateSource;
  hasAsateelPermit: boolean;
  asateelPermitExpiry?: string;
  gpsLastPingTimestamp?: string;
  driverEmiratesId?: string;
  routeOriginsAndDestinations: string[]; // e.g. ['Dubai', 'Abu Dhabi', 'Mussafah']
}

export interface DispatchGatingResult {
  allowed: boolean;
  jurisdiction: 'ABU_DHABI_ITC' | 'DUBAI_RTA' | 'FEDERAL_MOEI';
  status: 'COMPLIANT' | 'GATED_REJECTED' | 'WARNING';
  reasons: string[];
  permitActive: boolean;
  telemetryFresh: boolean;
}

/**
 * Validates Emirates ID format (784-YYYY-NNNNNNN-C or 15 digits starting with 784)
 */
export function isValidEmiratesId(eid: string | undefined): boolean {
  if (!eid) return false;
  const digits = eid.replace(/[-\s]/g, '');
  return /^\d{15}$/.test(digits) && digits.startsWith('784');
}

/**
 * Formats a live telematics ping into the official ITC Asateel Gateway JSON payload
 */
export function formatAsateelIngestionPayload(ping: AsateelTelemetryPing): AsateelPayloadOutput {
  return {
    itcStandardVersion: '2.4',
    authHeader: `Bearer ITC-ASATEEL-TOKEN-${ping.companyRegistrationNo}`,
    record: {
      CompanyId: ping.companyRegistrationNo,
      PlateNo: ping.vehiclePlate,
      PlateSource: ping.plateSource,
      ChassisNo: ping.vin,
      DeviceId: ping.gpsDeviceImei,
      DriverCivilId: ping.driverEmiratesId.replace(/[-\s]/g, ''),
      GPS: {
        Lat: Number(ping.latitude.toFixed(6)),
        Lng: Number(ping.longitude.toFixed(6)),
        Speed: Math.max(0, Math.round(ping.speedKmh)),
        Heading: Math.round(ping.headingDeg % 360),
        Alt: Math.round(ping.altitudeM || 0),
        FixTimeUtc: ping.timestamp,
      },
      Telemetry: {
        Ignition: ping.ignition ? 1 : 0,
        Odometer: Math.round(ping.odometerKm),
        FuelLevel: Math.round(ping.fuelLevelPct || 100),
        Alarm: ping.alarmCode || 'NORMAL',
      },
    },
  };
}

/**
 * Pre-dispatch Compliance Gating for Cross-Emirate and Abu Dhabi Corridor Trips
 */
export function evaluateAsateelDispatchGating(check: AsateelGatingCheck): DispatchGatingResult {
  const reasons: string[] = [];
  const touchesAbuDhabi = check.routeOriginsAndDestinations.some(loc => {
    const l = loc.toLowerCase();
    return l.includes('abu dhabi') || l.includes('auh') || l.includes('mussafah') || l.includes('al ain') || l.includes('al dhafra') || l.includes('kizad') || l.includes('icad');
  });

  const touchesDubai = check.routeOriginsAndDestinations.some(loc => {
    const l = loc.toLowerCase();
    return l.includes('dubai') || l.includes('dxb') || l.includes('jebel ali') || l.includes('deira') || l.includes('al quoz');
  });

  const jurisdiction = touchesAbuDhabi
    ? 'ABU_DHABI_ITC'
    : (touchesDubai ? 'DUBAI_RTA' : 'FEDERAL_MOEI');

  // Check 1: Emirates ID validity for driver
  if (!isValidEmiratesId(check.driverEmiratesId)) {
    reasons.push(`Driver Emirates ID is missing or invalid: '${check.driverEmiratesId || 'UNASSIGNED'}'. Required by UAE transport regulations.`);
  }

  // Check 2: Asateel Mandate (Required whenever operating in Abu Dhabi)
  let permitActive = true;
  if (touchesAbuDhabi) {
    if (!check.hasAsateelPermit) {
      permitActive = false;
      reasons.push('Vehicle lacks an active Abu Dhabi ITC Asateel Commercial Permit. Operation in Abu Dhabi will trigger automatic RTA/ITC fines.');
    } else if (check.asateelPermitExpiry) {
      const expiryDate = new Date(check.asateelPermitExpiry);
      const now = new Date();
      if (expiryDate < now) {
        permitActive = false;
        reasons.push(`Abu Dhabi ITC Asateel Permit expired on ${check.asateelPermitExpiry}.`);
      } else {
        const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000);
        if (daysLeft <= 15) {
          reasons.push(`WARNING: Asateel Permit expires in ${daysLeft} days.`);
        }
      }
    }
  }

  // Check 3: Telemetry Liveness (GPS device must have pinged within last 30 minutes)
  let telemetryFresh = true;
  if (check.gpsLastPingTimestamp) {
    const lastPing = new Date(check.gpsLastPingTimestamp).getTime();
    const ageMinutes = (Date.now() - lastPing) / (1000 * 60);
    if (ageMinutes > 30) {
      telemetryFresh = false;
      reasons.push(`Vehicle GPS telematics feed is stale (last ping was ${Math.round(ageMinutes)} mins ago). Live tracking connection required for dispatch.`);
    }
  } else {
    telemetryFresh = false;
    reasons.push('No telematics connection registered for this vehicle unit.');
  }

  const hasBlockingErrors = reasons.some(r => !r.startsWith('WARNING:'));
  const hasWarnings = reasons.some(r => r.startsWith('WARNING:'));

  return {
    allowed: !hasBlockingErrors,
    jurisdiction,
    status: hasBlockingErrors ? 'GATED_REJECTED' : (hasWarnings ? 'WARNING' : 'COMPLIANT'),
    reasons,
    permitActive,
    telemetryFresh,
  };
}
