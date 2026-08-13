# Follow-up: Trip event publishers not wired yet

The event contracts, registry entries, `NotificationEvent` enum values,
and `TripNotificationDispatchConsumer` for the full trip-lifecycle event
set are shipped. Three publishers already fire in the trip lifecycle
endpoints:

| Event | Publisher | Status |
|---|---|---|
| `trip.cancelled` | [/api/bus-ops/schedules/[id]/cancel](../src/app/api/bus-ops/schedules/[id]/cancel/route.ts) | ✅ live |
| `trip.departed` | [/api/bus-ops/schedules/[id]/depart](../src/app/api/bus-ops/schedules/[id]/depart/route.ts) | ✅ live |
| `trip.completed` | [/api/bus-ops/schedules/[id]/complete](../src/app/api/bus-ops/schedules/[id]/complete/route.ts) | ✅ live |
| `trip.arriving` | — | ⏳ not built |
| `trip.delayed` | — | ⏳ not built |
| `vehicle.changed` | — | ⏳ not built |
| `driver.changed` | — | ⏳ not built |
| `boarding.missed` | — | ⏳ not built |

The 5 remaining need real trigger logic — none of them are a
side-effect of a single HTTP endpoint. Each is a mini-feature:

## `trip.arriving`

**Trigger**: bus enters a "notify window" (default: **N=5 min** ETA to
the next stop / destination).

**Where to add**: [/api/bus-ops/schedules/[id]/eta](../src/app/api/bus-ops/schedules/[id]/eta/route.ts)
already computes ETAs. Extend it to remember the last-arriving-fired
stop per trip (either in-memory Set or a small `notified_arrivals`
table keyed on `(schedule_id, stop_id)`) and publish `trip.arriving`
once per (trip, stop). Payload fields: see `TripArrivingPayload` in
[trip.events.ts](../src/events/contracts/trip.events.ts).

**Idempotency**: fire once per (schedule, stop). A table beats an
in-memory set because ETA runs on multiple worker instances.

## `trip.delayed`

**Trigger**: `predicted_arrival - scheduled_arrival > tolerance` (default
5 min). Same code-path as `trip.arriving` — the ETA evaluator has both
figures on hand.

**Where to add**: same ETA endpoint. Same idempotency scoping: at most
once per (schedule, stop). Payload has a `reason` field
(`'traffic' | 'gps-lost' | 'unknown'`) — start with `'unknown'` and
enrich when we have signal (last-ping age → `'gps-lost'`; observed speed
drop → `'traffic'`).

## `vehicle.changed` / `driver.changed`

**Trigger**: `TripSchedule.vehicleId` or `driverId` changes.

**Where to add**: wherever schedules are PATCHed. Today that's:
- [/api/bus-ops/schedules/[id]](../src/app/api/bus-ops/schedules/[id]/route.ts) (main PATCH)
- Any programmatic reassign path (optimiser? re-planner?)

Read `previous` values before update, publish only if they actually
changed. Both events can be published from a shared helper so any future
schedule-mutation surface (bulk reassign, optimiser apply) picks it up
by calling the helper instead of duplicating the diff logic.

## `boarding.missed`

**Trigger**: bus leaves a stop and there are still-CONFIRMED
TripPassengers whose `boardingStopId` was that stop.

**Where to add**: [src/lib/bus-gps.ts](../src/lib/bus-gps.ts) — the stop-visit evaluator that flips
`TripStopVisit.leftAt`. After the write, run a scoped query for
still-CONFIRMED passengers on that stop and publish one
`boarding.missed` event per passenger. Also flip those passengers to
`NO_SHOW` in the same transaction (state machine already allows this).

**Idempotency**: per (passenger, stop). The passenger status change
guards against double-firing (a NO_SHOW passenger doesn't re-trigger).

## Notes for all publishers

- Wrap each `getEventBus().publish()` in a `.catch()` so a bad outbox
  write can't block the primary business action. Mirror the pattern in
  [depart/route.ts](../src/app/api/bus-ops/schedules/[id]/depart/route.ts).
- Reuse the aggregate id: `TripSchedule.id` for the trip events;
  `TripPassenger.id` for `boarding.missed` (with `scheduleId` in the
  payload for correlation).
- Register a `TripNotificationDispatchConsumer` per event type in
  [outbox-publisher.ts](../src/lib/jobs/outbox-publisher.ts) — already done in this
  commit. Publishers don't need to touch the consumer registration.
- Seed default `NotificationRule` rows via a migration or admin UI:
  operators need at least a default channel + recipient per event to
  see anything happen at runtime. Otherwise `TripNotificationDispatchConsumer`
  will log "no enabled rules for X — nothing to dispatch".
