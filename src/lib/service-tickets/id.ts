/**
 * Deterministic Service-Ticket ID display.
 *
 * Format: ST{year}-{TYPE}-{NNNN}
 *   ST2026-MNT-0001
 *   ST2026-REN-0017
 *   ST2026-INC-0002
 *
 * Same defensive client-side derivation as service-request-id.ts: until
 * the backend stamps `readableId` server-side (atomic per-type per-year
 * counter), the UI computes a stable ticker from creation order.
 *
 * Sequence per (type, year) starts at 0001.
 *
 *   const map = buildTicketIdMap(tickets);
 *   formatTicketId(ticket, map)   // "ST2026-MNT-0001"
 *
 * ── Backend TODO ────────────────────────────────────────────────────────────
 * Canonical fix: the API that creates a ServiceTicket should atomically
 * compute the next sequence for (ticket_type, year) — e.g. a counter table
 * service_ticket_sequences (ticket_type, year, last_seq) with SELECT … FOR
 * UPDATE — and persist `readable_id` on the row. Once that ships, this
 * helper stays as a client-side fallback for migrated rows missing the
 * column.
 */

import type { ServiceTicket, TicketType } from '@/types/service-tickets';
import { TICKET_TYPE_CONFIG } from './config';

const FIRST_SEQ = 1;

export function buildTicketIdMap(tickets: ServiceTicket[]): Map<string, string> {
  const sorted = [...tickets].sort((a, b) => {
    const da = new Date(a.createdAt ?? 0).getTime();
    const db = new Date(b.createdAt ?? 0).getTime();
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  // Per-(type, year) counters
  const counters = new Map<string, number>();
  const out = new Map<string, string>();

  for (const t of sorted) {
    if (t.readableId) {
      out.set(t.id, t.readableId);
      continue;
    }
    const ts = new Date(t.createdAt ?? Date.now());
    const year = isFinite(ts.getTime()) ? ts.getFullYear() : new Date().getFullYear();
    const key = `${t.ticketType}|${year}`;
    const prefix = TICKET_TYPE_CONFIG[t.ticketType]?.prefix ?? 'GEN';
    const next = (counters.get(key) ?? FIRST_SEQ - 1) + 1;
    counters.set(key, next);
    out.set(t.id, `ST${year}-${prefix}-${String(next).padStart(4, '0')}`);
  }
  return out;
}

export function formatTicketId(ticket: ServiceTicket, map: Map<string, string>): string {
  return ticket.readableId ?? map.get(ticket.id) ?? ticket.id;
}

/** Parse a ticker — returns the ticket type or null if the format isn't recognised. */
export function parseTicketTypeFromId(readableId: string): TicketType | null {
  const m = /^ST\d{4}-([A-Z]{3})-\d+$/.exec(readableId);
  if (!m) return null;
  const prefix = m[1];
  for (const [type, cfg] of Object.entries(TICKET_TYPE_CONFIG)) {
    if (cfg.prefix === prefix) return type as TicketType;
  }
  return null;
}
