/**
 * Canonical Rent-A-Car (RAC) Vehicle Categories & Customer Segments
 *
 * Shared across all RAC Admin UI pages, Counter PWA, Yield/Rate Simulator,
 * AI Booking Copilot, Unified Tenant Portal, and Standalone B2B RAC Portal so
 * dropdown values always match `pricing_rules.vehicle_category` and
 * `normalizeRentalCategory` in `src/lib/rental-yield-engine.ts`.
 */

import { categoriesMatch, normalizeRentalCategory } from '@/lib/rental-yield-engine';

export { normalizeRentalCategory, categoriesMatch };

export interface RentalCategoryOption {
  value: string;
  label: string;
  shortLabel: string;
}

export const RENTAL_VEHICLE_CATEGORIES: readonly RentalCategoryOption[] = [
  { value: 'ECONOMY',       label: 'Economy (Yaris / Sunny)',           shortLabel: 'Economy' },
  { value: 'COMPACT',       label: 'Compact (Corolla / Civic)',         shortLabel: 'Compact' },
  { value: 'MID_SIZE',      label: 'Mid-Size Sedan (Camry / Altima)',   shortLabel: 'Mid-Size Sedan' },
  { value: 'FULL_SIZE',     label: 'Full-Size Sedan (Avalon / Taurus)', shortLabel: 'Full-Size Sedan' },
  { value: 'COMPACT_SUV',   label: 'Compact SUV (RAV4 / Tucson)',       shortLabel: 'Compact SUV' },
  { value: 'MID_SIZE_SUV',  label: 'Mid-Size SUV (Fortuner / X-Trail)', shortLabel: 'Mid-Size SUV' },
  { value: 'FULL_SIZE_SUV', label: 'Full-Size SUV (Patrol / Land Cruiser)', shortLabel: 'Full-Size SUV' },
  { value: 'LUXURY',        label: 'Luxury (E-Class / 5-Series / Range Rover)', shortLabel: 'Luxury' },
  { value: 'PREMIUM',       label: 'Premium Executive (Lexus ES / Genesis)', shortLabel: 'Premium' },
  { value: 'SPORTS',        label: 'Sports / Performance',              shortLabel: 'Sports' },
  { value: 'VAN',           label: 'Passenger Van / MPV (Hiace / Carnival)', shortLabel: 'Van / MPV' },
  { value: 'PICKUP',        label: 'Pickup / Light Commercial (Hilux)', shortLabel: 'Pickup' },
  { value: 'BUS',           label: 'Minibus / Coaster (14–30 Pax)',     shortLabel: 'Minibus / Bus' },
  { value: 'SPECIAL',       label: 'Special / Chauffeur / Custom',      shortLabel: 'Special' },
] as const;

export type RentalVehicleCategoryCode = (typeof RENTAL_VEHICLE_CATEGORIES)[number]['value'];

export const RENTAL_CUSTOMER_TYPES = [
  { value: 'INDIVIDUAL',     label: 'Individual (Retail / Walk-In)' },
  { value: 'CORPORATE',      label: 'Corporate B2B Account' },
  { value: 'AIRLINE',        label: 'Airline Crew / Partner' },
  { value: 'INSURANCE',      label: 'Insurance Replacement' },
  { value: 'FREQUENT_FLYER', label: 'Frequent Flyer / Loyalty' },
  { value: 'GOVERNMENT',     label: 'Government / Diplomatic' },
] as const;

export function formatRentalCategoryLabel(
  raw: string | null | undefined,
  opts?: { short?: boolean },
): string {
  if (!raw) return '—';
  const norm = normalizeRentalCategory(raw);
  const found = RENTAL_VEHICLE_CATEGORIES.find((c) => c.value === norm);
  if (found) {
    return opts?.short ? found.shortLabel : found.label;
  }
  return raw
    .trim()
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
