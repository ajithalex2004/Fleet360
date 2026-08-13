# Follow-up: Alert Engine — remaining publishers + escalation cron

Phase 1 (shipped) ships the shared engine: extended `Alert` model +
`AlertRule` table + `AlertEngineConsumer` + `raiseAlert()` helper +
one reference publisher (bus-ops incidents → `VEHICLE_BREAKDOWN`).

## Publishers still to wire

Each of the 10 alert conditions needs a publisher. All should call
`raiseAlert({...})` from [src/lib/alerts/raise.ts](../src/lib/alerts/raise.ts) — never
`prisma.alert.create()` directly.

| Code | Trigger | Status |
|---|---|---|
| `VEHICLE_BREAKDOWN` | driver-app breakdown report OR incident type=BREAKDOWN | ✅ [/api/bus-ops/incidents](../src/app/api/bus-ops/incidents/route.ts) |
| `PASSENGER_ABSENT` | bus depart: CONFIRMED → NO_SHOW flip | ✅ [/api/bus-ops/schedules/[id]/depart](../src/app/api/bus-ops/schedules/[id]/depart/route.ts) |
| `LATE_DEPARTURE` | depart: actual > scheduled + tolerance (5 min) | ✅ same depart handler |
| `LATE_ARRIVAL` | ETA evaluator: predicted > scheduled + tolerance (5 min), dedup per (schedule, stop) | ✅ [/api/bus-ops/schedules/[id]/eta](../src/app/api/bus-ops/schedules/[id]/eta/route.ts) |
| `CAPACITY_EXCEEDED` | trip create: expanded roster > capacity | ✅ [/api/bus-ops/schedules](../src/app/api/bus-ops/schedules/route.ts) |
| `TRIP_OVERDUE` | cron: `arrival + 15 min` passed with status still SCHEDULED/DEPARTED/IN_TRANSIT | ✅ [src/lib/jobs/alert-trip-overdue.ts](../src/lib/jobs/alert-trip-overdue.ts) — register a Vercel cron entry pointing at `/api/jobs/run?job=alert-trip-overdue` |
| `VEHICLE_OFFLINE` | GPS ingest: no ping received for N minutes | ⏳ TODO — sweep in [src/lib/bus-gps.ts](../src/lib/bus-gps.ts) |
| `MISSED_STOP` | stop-visit evaluator: bus never entered a scheduled stop's geofence | ⏳ TODO — stop-visit evaluator |
| `DRIVER_ABSENT` | pre-trip: no driver check-in within N min of departure | ⏳ TODO — new pre-trip check-in concept OR cron on trips lacking a BusPreTripCheck |
| `ROUTE_DEVIATION` | GPS evaluator: bus > N metres off route corridor | ⏳ TODO — new evaluator |

**Dedup keys** — the engine defaults to `${code}:${subjectId}`. Use
explicit keys when a coarser grain is wanted:

- `VEHICLE_OFFLINE`: `${code}:${vehicleId}` (one alert per vehicle until
  it pings again)
- `TRIP_OVERDUE`: `${code}:${scheduleId}` (one per trip)
- `LATE_ARRIVAL`: `${code}:${scheduleId}:${stopId}` (one per stop)

## Escalation cron

Not shipped. Design:

- New cron job `alert-escalation` in [src/lib/jobs/](../src/lib/jobs/), runs every 1-2 min.
- For each OPEN Alert (`resolvedAt IS NULL`):
  - Load its AlertRule.
  - Compute the target level: highest `escalationLevels[i]` where
    `now >= createdAt + i.afterMinutes`.
  - If target > current `escalationLevel`, bump the level, set
    `lastEscalatedAt = now`, and write NotificationLog rows for the
    level's `channels × recipients` (same pattern as
    `TripNotificationDispatchConsumer`).
- Also flag SLA breaches: when `now > slaAckDueAt` and
  `acknowledgedAt IS NULL`, raise a downstream `alert.sla_breached`
  event (or increment a counter).

## Notification pipeline reuse ✅ SHIPPED

`AlertEngineConsumer` now writes one `NotificationLog` row per
`channel × recipient` at creation time (via `enqueueNotifications()`
helper in the same file), so the existing channel workers deliver
alerts without an alert-specific delivery pipeline. `triggerReason`
threads the alert id so ops can trace a delivery back to the alert
that raised it.

## Legacy `Alert` writers to clean up

Grep for direct `prisma.alert.create` calls and migrate each to
`raiseAlert()`. Today (post-refactor) there should be zero — verify
with:

```bash
grep -r "prisma\.alert\.create" src/
```

If any survive, they're pre-Alert-Engine and bypass severity / channel
/ SLA routing.

## Seeding default AlertRules

Ops need at least one enabled AlertRule per condition per tenant or
the engine creates Alerts with no channels/recipients (silent alerts).
Add a seed migration or an admin-UI onboarding step that inserts
sensible defaults for the 10 codes. Example:

```sql
INSERT INTO public.alert_rules
  (id, tenant_id, code, default_severity, default_channels,
   recipient_types, sla_ack_minutes, sla_resolve_minutes)
VALUES
  (gen_random_uuid()::text, $tenant, 'VEHICLE_BREAKDOWN', 'HIGH',
   ARRAY['PUSH','SMS','EMAIL'], ARRAY['FLEET_MANAGER','OPS_LEAD'], 5, 60);
```
