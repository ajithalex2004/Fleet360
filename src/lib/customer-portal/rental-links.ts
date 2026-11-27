/**
 * Link between a Customer Management customer (customers) and its Rental
 * customer (rental_customers) — customer_rental_links.
 *
 * Rental bookings, agreements and invoices belong to the rental customer; the
 * Customer Portal shows the linked rental customer's rentals to the company's
 * Transport users (Rent-a-Car category). One link per customer and per rental
 * customer. Exact matches were linked by migration; staff set the rest.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';

export interface RentalCustomerOption {
  id: string;
  name: string;
  companyName: string | null;
  tradeLicense: string | null;
  email: string | null;
  customerType: string | null;
  /** Customer Management customer it is already linked to, if any. */
  linkedCustomerId: string | null;
}

export class RentalLinkError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

interface OptionRow {
  id: string; full_name: string; company_name: string | null; trade_license: string | null;
  email: string | null; customer_type: string | null; linked_customer_id: string | null;
}

const OPTION_COLS = `rc.id::text, rc.full_name, rc.company_name, rc.trade_license, rc.email, rc.customer_type,
  (SELECT l.customer_id FROM customer_rental_links l WHERE l.tenant_id = $1 AND l.rental_customer_id = rc.id::text) AS linked_customer_id`;

function toOption(r: OptionRow): RentalCustomerOption {
  return {
    id: r.id, name: r.full_name, companyName: r.company_name, tradeLicense: r.trade_license, email: r.email,
    customerType: r.customer_type, linkedCustomerId: r.linked_customer_id,
  };
}

/** The rental customer linked to a customer, or null. */
export async function rentalCustomerIdFor(tenantId: string, customerId: string, tx?: TxClient): Promise<string | null> {
  const run = (t: TxClient) => t.$queryRawUnsafe<Array<{ rental_customer_id: string }>>(
    `SELECT rental_customer_id FROM customer_rental_links WHERE tenant_id = $1 AND customer_id = $2`, tenantId, customerId,
  );
  const rows = tx ? await run(tx) : await withTenantRls(prisma, tenantId, run).catch(() => []);
  return rows[0]?.rental_customer_id ?? null;
}

export async function getRentalLink(tenantId: string, customerId: string): Promise<RentalCustomerOption | null> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<OptionRow[]>(
      `SELECT ${OPTION_COLS} FROM rental_customers rc
         JOIN customer_rental_links l ON l.tenant_id = $1 AND l.rental_customer_id = rc.id::text AND l.customer_id = $2
        WHERE rc.tenant_id::text = $1`,
      tenantId, customerId,
    ),
  );
  return rows[0] ? toOption(rows[0]) : null;
}

/** Rental customers matching a search (name, company, trade licence, email), at most 20. */
export async function searchRentalCustomers(tenantId: string, q: string): Promise<RentalCustomerOption[]> {
  const term = q.trim().slice(0, 80);
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<OptionRow[]>(
      `SELECT ${OPTION_COLS} FROM rental_customers rc
        WHERE rc.tenant_id::text = $1 AND rc.deleted_at IS NULL
          AND ($2 = '' OR rc.full_name ILIKE $3 OR rc.company_name ILIKE $3 OR rc.trade_license ILIKE $3 OR rc.email ILIKE $3)
        ORDER BY (rc.customer_type = 'CORPORATE') DESC, COALESCE(rc.company_name, rc.full_name)
        LIMIT 20`,
      tenantId, term, like,
    ),
  );
  return rows.map(toOption);
}

/** Links (or with null, unlinks) a customer to a rental customer of the same tenant. */
export async function setRentalLink(
  tenantId: string, customerId: string, rentalCustomerId: string | null, by: string,
): Promise<RentalCustomerOption | null> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const [c] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, customerId, tenantId,
    );
    if (!c) throw new RentalLinkError('Customer not found.', 404);
    if (!rentalCustomerId) {
      await tx.$executeRawUnsafe(`DELETE FROM customer_rental_links WHERE tenant_id = $1 AND customer_id = $2`, tenantId, customerId);
      return null;
    }
    const [rc] = await tx.$queryRawUnsafe<OptionRow[]>(
      `SELECT ${OPTION_COLS} FROM rental_customers rc WHERE rc.tenant_id::text = $1 AND rc.id::text = $2 AND rc.deleted_at IS NULL`,
      tenantId, rentalCustomerId,
    );
    if (!rc) throw new RentalLinkError('Rental customer not found.', 404);
    if (rc.linked_customer_id && rc.linked_customer_id !== customerId) {
      throw new RentalLinkError('That rental customer is already linked to another customer.', 409);
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO customer_rental_links (tenant_id, customer_id, rental_customer_id, linked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, customer_id)
       DO UPDATE SET rental_customer_id = EXCLUDED.rental_customer_id, linked_by = EXCLUDED.linked_by, linked_at = NOW()`,
      tenantId, customerId, rentalCustomerId, by,
    );
    return toOption({ ...rc, linked_customer_id: customerId });
  });
}
