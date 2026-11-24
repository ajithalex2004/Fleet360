/**
 * Ticket-type catalogue — which service types a tenant can raise tickets for.
 *
 * A service type is a ticket type when its `service_module_mapping` row links
 * it to SERVICE_TICKETING. That covers the seven seeded system types and any
 * tenant-defined type (e.g. the Facilities catalogue) without code changes.
 *
 * The service-config tables have no RLS (see migration
 * 20260910000033_service_config_engine_tables), so every query here filters
 * on tenant_id explicitly, matching load.ts.
 */

import { prisma } from '@/lib/prisma';
import { ensureSeededForTenant } from '@/lib/service-config/schema';
import { getTenantAccessMatrix } from './access';
import { TICKET_TYPE_KEY_RE, type TicketType } from '@/types/service-tickets';

export interface TicketCatalogueEntry {
  key: TicketType;
  name: string;
  categoryKey: string;
  categoryName: string;
  isSystem: boolean;
  sortOrder: number;
}

interface Row {
  key: string; name: string; category_key: string; category_name: string;
  is_system: boolean; sort_order: number; category_sort: number;
}

/** All ticket-capable service types for the tenant, ignoring the access matrix. */
export async function listTicketCatalogue(tenantId: string): Promise<TicketCatalogueEntry[]> {
  await ensureSeededForTenant(tenantId);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT t.key, t.name, c.key AS category_key, c.name AS category_name,
            t.is_system, t.sort_order, c.sort_order AS category_sort
       FROM service_types t
       JOIN service_module_mapping m ON m.service_type_id = t.id
       JOIN service_categories c     ON c.id = t.category_id AND c.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND t.deleted_at IS NULL AND c.deleted_at IS NULL
        AND m.linked_module = 'SERVICE_TICKETING'
      ORDER BY c.sort_order, t.sort_order, t.name`,
    tenantId,
  ).catch(() => [] as Row[]);
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    categoryKey: r.category_key,
    categoryName: r.category_name,
    isSystem: r.is_system,
    sortOrder: r.sort_order ?? 0,
  }));
}

/**
 * Ticket types the tenant may use: the catalogue minus any type an admin
 * explicitly disabled in `tenant_ticket_types`. Types without an access row
 * are enabled by default (same convention as the system types).
 */
export async function listEnabledTicketTypes(tenantId: string): Promise<TicketCatalogueEntry[]> {
  const [catalogue, matrix] = await Promise.all([
    listTicketCatalogue(tenantId),
    getTenantAccessMatrix(tenantId),
  ]);
  const disabled = new Set(matrix.filter((r) => !r.enabled).map((r) => r.ticketType));
  return catalogue.filter((e) => !disabled.has(e.key));
}

/** True when `key` is a ticket type this tenant may raise. */
export async function isEnabledTicketType(tenantId: string, key: string): Promise<boolean> {
  if (!TICKET_TYPE_KEY_RE.test(key)) return false;
  const enabled = await listEnabledTicketTypes(tenantId);
  return enabled.some((e) => e.key === key);
}
