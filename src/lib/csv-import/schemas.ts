/**
 * Zod schemas + header aliases for the CSV import endpoints.
 * Keep field names aligned with the Prisma model fields so the inserter
 * is a thin pass-through.
 */

import { z } from 'zod';

/* ── Vehicle import ──────────────────────────────────────────────────────── */

export const vehicleImportSchema = z.object({
  make: z.string().min(1, 'make is required'),
  model: z.string().min(1, 'model is required'),
  type: z.string().optional(),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  licensePlate: z.string().min(1, 'licensePlate is required'),
  vin: z.string().min(1).optional(),
  color: z.string().optional(),
  fuelType: z.string().optional(),
  vehicleUsage: z.string().optional(), // RENTAL|STAFF|SCHOOL_BUS|LOGISTICS|AMBULANCE|POOL|EXECUTIVE
  vehicleGroup: z.string().optional(),
  vehicleClass: z.string().optional(),
  seatingCapacity: z.coerce.number().int().min(1).max(80).optional(),
  status: z.string().optional(),
  currentMileage: z.coerce.number().int().min(0).optional(),
});
export type VehicleImportRow = z.infer<typeof vehicleImportSchema>;

export const vehicleHeaderAliases: Record<string, string[]> = {
  make: ['brand', 'manufacturer'],
  model: ['model name'],
  type: ['vehicle type', 'category'],
  year: ['model year', 'year of make'],
  licensePlate: ['plate', 'plate number', 'plate no', 'license no', 'mulkiya number'],
  vin: ['vin number', 'chassis', 'chassis number', 'chassis no'],
  color: ['colour'],
  fuelType: ['fuel'],
  vehicleUsage: ['usage', 'use'],
  vehicleGroup: ['group'],
  vehicleClass: ['class'],
  seatingCapacity: ['seats', 'seating', 'passenger capacity', 'pax'],
  status: ['vehicle status', 'state'],
  currentMileage: ['mileage', 'odometer', 'km', 'kilometres', 'kilometers'],
};

/* ── Lessee import ───────────────────────────────────────────────────────── */
/* B2B (corporate) and B2C (individual) supported via the `type` field.
 * Each row is checked by a discriminated union — corporate rows must have
 * tradeLicense; individual rows must have emiratesId + nationality. */

const lesseeBase = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().optional(),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
});

const lesseeCorporate = lesseeBase.extend({
  type: z.literal('corporate'),
  tradeLicense: z.string().min(1, 'tradeLicense is required for corporate lessees'),
});

const lesseeIndividual = lesseeBase.extend({
  type: z.literal('individual'),
  emiratesId: z.string().min(15, 'emiratesId must be at least 15 characters'),
  nationality: z.string().min(1, 'nationality is required for individual lessees'),
  licenseNo: z.string().optional(),
});

export const lesseeImportSchema = z
  .preprocess(
    (val) => {
      // Coerce common type aliases to canonical 'corporate' | 'individual'
      if (val && typeof val === 'object' && 'type' in val) {
        const v = (val as any).type;
        if (typeof v === 'string') {
          const t = v.toLowerCase().trim();
          if (['b2b', 'company', 'corp', 'corporate'].includes(t)) {
            (val as any).type = 'corporate';
          } else if (['b2c', 'person', 'individual', 'retail'].includes(t)) {
            (val as any).type = 'individual';
          }
        }
      }
      return val;
    },
    z.discriminatedUnion('type', [lesseeCorporate, lesseeIndividual]),
  );
export type LesseeImportRow = z.infer<typeof lesseeImportSchema>;

export const lesseeHeaderAliases: Record<string, string[]> = {
  name: ['lessee name', 'company name', 'full name', 'customer name'],
  type: ['lessee type', 'customer type', 'category', 'b2b/b2c'],
  email: ['email address', 'mail'],
  phone: ['mobile', 'phone number', 'contact number'],
  address: ['address line', 'office address'],
  contactPerson: ['contact', 'contact name', 'rep'],
  tradeLicense: ['trade license', 'trade license no', 'tl', 'tl number'],
  emiratesId: ['emirates id', 'eid', 'emirates id number'],
  nationality: ['nationality', 'nation'],
  licenseNo: ['driving license', 'license number', 'driver license'],
};
