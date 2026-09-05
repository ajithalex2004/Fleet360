/**
 * Ground-Truth Benchmark Datasets for Fleet360 Agent Quality Evaluation
 * ---------------------------------------------------------------------
 * Standardized test cases with expected ground-truth labels for:
 *  1. Finance Anomaly Detection (8 operational streams)
 *  2. 9-Signal Predictive Maintenance
 *  3. Smart Dispatch 15-Factor Scoring
 *  4. Staff Transport Multi-Shift Geoclustering
 */

import {
  MaintenanceRecord,
  FuelLogRecord,
  VendorInvoiceRecord,
  TripTollRecord,
  ContractAuditRecord,
} from '../finance-anomaly/detectors';
import { ComprehensiveVehicleInput } from '../predictive-maintenance/scoring';
import { DriverCandidate, JobRequirements } from '../dispatch-optimiser/scoring';

export const FINANCE_GROUND_TRUTH_DATASETS: {
  maintenance: MaintenanceRecord[];
  fuel: FuelLogRecord[];
  invoices: VendorInvoiceRecord[];
  tolls: TripTollRecord[];
  contracts: ContractAuditRecord[];
} = {
  maintenance: [
    {
      id: 'maint-pos-1',
      vehicleId: 'v-101',
      vehicleCode: 'BUS-01',
      workOrderId: 'maint-pos-1',
      garageName: 'Al Quoz Garage',
      partName: 'Brake Disc Set',
      partNumber: 'BRK-554',
      invoicedPartPrice: 1200.0, // Baseline is 600 -> 100% inflation!
      catalogBaselinePrice: 600.0,
      invoicedLaborHours: 2.0,
      standardLaborHours: 2.0,
      laborRatePerHour: 100.0,
      serviceDate: new Date().toISOString(),
      warrantyDays: 60,
    },
    {
      id: 'maint-clean-1',
      vehicleId: 'v-102',
      vehicleCode: 'BUS-02',
      workOrderId: 'maint-clean-1',
      garageName: 'Authorized Agency',
      partName: 'Air Filter',
      partNumber: 'FLT-101',
      invoicedPartPrice: 150.0,
      catalogBaselinePrice: 150.0,
      invoicedLaborHours: 1.0,
      standardLaborHours: 1.0,
      laborRatePerHour: 100.0,
      serviceDate: new Date().toISOString(),
      warrantyDays: 60,
    },
  ],
  fuel: [
    {
      id: 'fuel-pos-1',
      vehicleId: 'v-201',
      vehicleCode: 'VAN-11',
      liters: 110.0, // Tank is 80L -> 110L is 137.5% capacity!
      tankCapacityLiters: 80.0,
      totalCost: 333.3,
      fuelGrade: 'SPECIAL_95',
      stationName: 'Eppco Al Wasl',
      stationLat: 25.2048,
      stationLng: 55.2708,
      vehicleLatAtTime: 25.2048,
      vehicleLngAtTime: 55.2708,
      fuelDate: new Date().toISOString(),
    },
    {
      id: 'fuel-pos-2',
      vehicleId: 'v-202',
      vehicleCode: 'VAN-12',
      liters: 60.0,
      tankCapacityLiters: 80.0,
      totalCost: 181.8,
      fuelGrade: 'SPECIAL_95',
      stationName: 'Enoc Al Barsha',
      stationLat: 25.1124,
      stationLng: 55.2001,
      vehicleLatAtTime: 24.4539, // Abu Dhabi (120km away) -> GPS Mismatch!
      vehicleLngAtTime: 54.3773,
      fuelDate: new Date().toISOString(),
    },
    {
      id: 'fuel-clean-1',
      vehicleId: 'v-203',
      vehicleCode: 'VAN-13',
      liters: 50.0,
      tankCapacityLiters: 80.0,
      totalCost: 151.5,
      fuelGrade: 'SPECIAL_95',
      stationName: 'Adnoc DIP',
      stationLat: 24.9857,
      stationLng: 55.1764,
      vehicleLatAtTime: 24.9859,
      vehicleLngAtTime: 55.1766,
      fuelDate: new Date().toISOString(),
    },
  ],
  invoices: [
    {
      id: 'inv-pos-1',
      invoiceNumber: 'INV-2026-991',
      vendorName: 'Global Tyres LLC',
      vendorTrn: '100234567800003',
      invoiceDate: new Date().toISOString(),
      subtotal: 1000.0,
      vatAmount: 150.0, // Expected 5% = 50 AED, billed 150 AED -> VAT Error!
      totalAmount: 1150.0,
      category: 'PARTS',
      currency: 'AED',
    },
    {
      id: 'inv-clean-1',
      invoiceNumber: 'INV-2026-992',
      vendorName: 'Al Futtaim Auto',
      vendorTrn: '100987654300003',
      invoiceDate: new Date().toISOString(),
      subtotal: 2000.0,
      vatAmount: 100.0, // Exactly 5%
      totalAmount: 2100.0,
      category: 'PARTS',
      currency: 'AED',
    },
  ],
  tolls: [
    {
      id: 'toll-pos-1',
      vehicleId: 'v-301',
      vehicleCode: 'BUS-44',
      tollGateName: 'Al Barsha Salik',
      tollAmount: 4.0,
      timestamp: new Date().toISOString(),
      isBilledToCustomer: false,
      isDeductedFromDriver: false,
      responsibleParty: 'CUSTOMER',
    },
  ],
  contracts: [
    {
      id: 'contract-pos-1',
      contractNumber: 'CTR-2026-004',
      vehicleId: 'v-401',
      vehicleCode: 'TRK-01',
      customerId: 'cust-1',
      customerName: 'Emirates Logistics Group',
      contractStatus: 'CLOSED',
      allowedMonthlyKm: 4000,
      startOdometer: 10000,
      checkInOdometer: 15000,
      currentTelematicsOdometer: 18500, // 3,500 km off-contract unaccounted movement!
      excessKmRateAed: 0.75,
      excessKmBilled: false,
    },
  ],
};

export const MAINTENANCE_GROUND_TRUTH_VEHICLE: ComprehensiveVehicleInput = {
  id: 'veh-bench-crit',
  vehicleCode: 'BUS-CRIT-99',
  make: 'Mercedes-Benz',
  model: 'Travego 50-Seater',
  licensePlate: 'DXB-99881',
  purchaseDate: '2020-01-15',
  odometerReading: 185000,
  daysSinceLastService: 150,
  kmSinceLastService: 16000,
  baselineFuelLper100: 22.0,
  recentFuelLper100: 31.5,
  openWorkOrders: 3,
  workOrdersLast90Days: 4,
  historicalRepairs: [
    {
      workOrderId: 'wo-rep-1',
      system: 'Cooling System',
      subsystem: 'POWERTRAIN',
      description: 'Coolant leak repaired',
      completedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      workOrderId: 'wo-rep-2',
      system: 'Cooling System',
      subsystem: 'POWERTRAIN',
      description: 'Radiator hose burst',
      completedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
  ],
  activeDtcCodes: ['P0300', 'P0171', 'P0420'],
  sensors: {
    coolantTempC: 112,
    oilPressureKpa: 120,
    batteryVoltage: 11.8,
    transmissionTempC: 105,
  },
  engineOperatingHours: 4200,
};

export const DISPATCH_BENCHMARK_JOB: JobRequirements = {
  jobId: 'job-bench-1',
  serviceType: 'EXECUTIVE_SEDAN',
  priority: 'HIGH',
  pickupLat: 25.2048,
  pickupLng: 55.2708,
  dropoffLat: 25.2532,
  dropoffLng: 55.3657,
  requiredCapacity: 4,
  requiredVehicleTypes: ['EXECUTIVE_SEDAN'],
  requiredLicenseClass: 'LIGHT',
  slaDeadline: new Date(Date.now() + 45 * 60000),
  estimatedDurationMin: 45,
  customerLanguage: 'English',
  zoneId: 'Downtown',
};

export const DISPATCH_BENCHMARK_CANDIDATES: {
  optimal: DriverCandidate;
  distant: DriverCandidate;
} = {
  optimal: {
    driverId: 'drv-opt-1',
    driverName: 'Rashid Khan',
    vehicleId: 'veh-opt-1',
    vehicleCode: 'SED-01',
    vehicleType: 'EXECUTIVE_SEDAN',
    capacity: 4,
    currentLat: 25.2100,
    currentLng: 55.2750,
    avgSpeedKmh: 45,
    hoursRemainingToday: 7.5,
    ragScore: 95,
    fatigueScore: 0.1,
    currentJobCount: 0,
    languages: ['Arabic', 'English'],
    licenseClasses: ['LIGHT'],
    vehicleRiskScore: 0.1,
    zonesServed: ['Downtown', 'Business Bay'],
    isVehicleRegistered: true,
    isVehicleInsured: true,
    isDriverLicensed: true,
  },
  distant: {
    driverId: 'drv-dist-2',
    driverName: 'Farhan Ali',
    vehicleId: 'veh-dist-2',
    vehicleCode: 'SED-02',
    vehicleType: 'EXECUTIVE_SEDAN',
    capacity: 4,
    currentLat: 24.4539,
    currentLng: 54.3773,
    avgSpeedKmh: 45,
    hoursRemainingToday: 1.0,
    ragScore: 60,
    fatigueScore: 0.6,
    currentJobCount: 2,
    languages: ['Urdu'],
    licenseClasses: ['LIGHT'],
    vehicleRiskScore: 0.85,
    zonesServed: ['Abu Dhabi'],
    isVehicleRegistered: true,
    isVehicleInsured: true,
    isDriverLicensed: true,
  },
};
