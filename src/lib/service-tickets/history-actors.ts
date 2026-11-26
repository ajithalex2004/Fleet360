/**
 * Request lifecycle: who made each change.
 *
 * service_tickets.history entries record `actor` as whatever the writer had —
 * usually the staff user's id, sometimes a name (e.g. a WhatsApp requester).
 * This adds `actorName` to each entry: the user's full name (or username)
 * when `actor` is a user id, otherwise the actor text itself.
 */

import type { TxClient } from '@/lib/rls';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WithHistory { history?: unknown; assignedTo?: string | null }

export async function resolveHistoryActors<T extends WithHistory>(tx: TxClient, tickets: T[]): Promise<T[]> {
  const ids = new Set<string>();
  for (const t of tickets) {
    if (Array.isArray(t.history)) {
      for (const e of t.history as Array<Record<string, unknown>>) {
        if (typeof e?.actor === 'string' && UUID_RE.test(e.actor)) ids.add(e.actor);
      }
    }
    if (t.assignedTo && UUID_RE.test(t.assignedTo)) ids.add(t.assignedTo);
  }
  if (ids.size === 0) return tickets;

  const rows = await tx.$queryRawUnsafe<Array<{ id: string; firstName: string | null; lastName: string | null; username: string | null }>>(
    `SELECT id, "firstName", "lastName", username FROM "User" WHERE id = ANY($1::text[])`,
    [...ids],
  ).catch(() => [] as Array<{ id: string; firstName: string | null; lastName: string | null; username: string | null }>);
  const names = new Map(rows.map((r) => [r.id, [r.firstName, r.lastName].filter(Boolean).join(' ') || r.username || r.id]));

  return tickets.map((t) => ({
    ...t,
    history: Array.isArray(t.history)
      ? (t.history as Array<Record<string, unknown>>).map((e) => ({
          ...e,
          actorName: typeof e?.actor === 'string' ? (names.get(e.actor) ?? e.actor) : 'System',
        }))
      : t.history,
    assignedToName: t.assignedTo ? (names.get(t.assignedTo) ?? t.assignedTo) : null,
  }));
}
