/**
 * Fuel domain event contracts.
 */

export const FUEL_FILLED = 'fuel.filled' as const;

export interface FuelFilledPayload {
  /** fuel_logs.id */
  fuelLogId:    string;
  vehicleId:    string;
  driverId:     string | null;
  fuelDate:     string;   // ISO date YYYY-MM-DD
  liters:       number;
  costPerLiter: number | null;
  totalCost:    number | null;
  station:      string | null;
}
