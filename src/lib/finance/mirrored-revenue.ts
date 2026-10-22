/**
 * Excluding module-mirrored invoices from a finance_invoices revenue sum.
 *
 * src/lib/finance/module-ledger.ts copies operational invoices into
 * finance_invoices, tagged module_source = 'RENTAL' | 'LOGISTICS' | 'LEASING'.
 * A report that sums a module's own table (rental_invoices,
 * logistics_shipment_orders, lease_invoices, …) AND finance_invoices counted
 * that revenue twice — in management accounts, the finance summary, the VAT
 * return and corporate tax.
 *
 * finance_invoices cannot be the only source yet: not every operational
 * invoice is mirrored (rental invoices from agreement close and the manual
 * rental invoice endpoint publish no event; logistics mirrors only on CLOSED,
 * while revenue counts DELIVERED and POD_SUBMITTED too; leasing has no
 * mirror at all). So a report keeps each module's own sum and leaves that
 * module's mirrored rows out of the finance_invoices sum — only for the
 * modules whose own table it actually sums.
 */
export type MirroredModule = 'RENTAL' | 'LOGISTICS' | 'LEASING';

/**
 * `AND <alias>module_source NOT IN (…)`, NULL-safe (a manual invoice has no
 * module_source and must stay in the sum). Fixed values only — never pass
 * anything from a request.
 */
export function excludeMirrored(modules: readonly MirroredModule[], alias = ''): string {
  if (modules.length === 0) return '';
  const col = alias ? `${alias}.module_source` : 'module_source';
  return ` AND COALESCE(${col}, '') NOT IN (${modules.map((m) => `'${m}'`).join(', ')})`;
}
