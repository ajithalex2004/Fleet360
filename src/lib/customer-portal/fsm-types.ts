/**
 * Pure helpers for per-customer Field Services (FSM) request type scoping.
 *
 * Semantics (100% backward compatible with existing `customer_portal_access` rows):
 *   - Empty array `[]` (or `null`/`undefined`) => customer may use ALL enabled
 *     FSM Customer Portal request types of the tenant.
 *   - Non-empty array `['FSM_REACT_BREAK_FIX', ...]` => customer is restricted
 *     strictly to those request type keys (intersected with tenant-enabled types).
 */

import { TICKET_TYPE_KEY_RE } from '@/types/service-tickets';

export interface FsmPortalTypeOption {
  key: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  priority: string;
}

const MAX_FSM_TYPES = 150;

/**
 * Validates and deduplicates an array of FSM request type keys.
 * Returns `[]` for an empty array (= all enabled types), or `null` if invalid.
 */
export function parseFsmRequestTypes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_FSM_TYPES) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const key = item.trim();
    if (!TICKET_TYPE_KEY_RE.test(key)) return null;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Filters tenant-eligible FSM type entries by a customer's optional whitelist. */
export function filterAllowedFsmTypes<T>(
  entries: ReadonlyArray<readonly [string, T]>,
  customerWhitelist: readonly string[] | null | undefined,
): Array<[string, T]> {
  if (!customerWhitelist || customerWhitelist.length === 0) {
    return entries.map(([k, v]) => [k, v]);
  }
  const allowed = new Set(customerWhitelist);
  return entries.filter(([k]) => allowed.has(k)).map(([k, v]) => [k, v]);
}

/** Returns true when a specific FSM request type key is permitted for the customer. */
export function isFsmTypeAllowedForCustomer(
  typeKey: string,
  customerWhitelist: readonly string[] | null | undefined,
): boolean {
  if (!customerWhitelist || customerWhitelist.length === 0) return true;
  return customerWhitelist.includes(typeKey);
}
