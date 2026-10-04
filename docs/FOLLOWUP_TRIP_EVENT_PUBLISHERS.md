# Trip event publishers and delivery status

Local implementation in progress (2026-10-04): five additional publishers now
write transactional outbox events. This code is not in PR #172's GitHub head or
deployed. Apply `20261004080000_bus_ops_stop_delay_marker` before running it.
The next local increment replaces the global trip notification consumer with
opt-in tenant rules and actual passenger employee contacts. It queues durable
per-event / passenger / channel deliveries, and the `bus-rider-notifications`
worker sends email, SMS or WhatsApp. Apply
`20261004090000_bus_rider_notifications` before running the consumer or worker.
This work remains local, unpushed and undeployed.

### Configuration and delivery

- **Bus Ops → Settings → Automatic rider notifications**: enable events, select
  channels and edit plain-text templates. All eight rules default to disabled;
  existing global rules do not activate this pipeline.
- Settings and delivery history use `/api/bus-ops/rider-notifications`, protected
  by tenant membership and Bus Ops `admin:planning-core`. Writes are audited.
- Approach events target only CONFIRMED riders at the specified boarding stop.
  Missed-boarding events target one ABSENT passenger. Completion targets BOARDED
  or ALIGHTED riders. Other events target CONFIRMED or BOARDED riders.
- Contacts are resolved only from active, nondeleted employees in the event's
  tenant. Riders without a linked active employee or a selected-channel contact
  are skipped. The worker rechecks tenant/module, rule, trip, rider and unchanged
  contact before each send.
- Unique `(tenant, event, passenger, channel)` keys prevent replay fanout.
  `FOR UPDATE SKIP LOCKED` and sender tokens prevent concurrent claims and stale
  outcome updates. No transaction is held during a provider call.
- Proven retryable rejections use exponential backoff (60 seconds initially,
  maximum five attempts). Network ambiguity, a timeout or a crashed sender lease
  becomes UNCERTAIN and is never automatically resent. Missing configuration and
  staging quarantine become BLOCKED. SENT means provider acceptance, not a
  passenger delivery receipt.
- Operators can retry unexpired BLOCKED or FAILED deliveries after resolving the
  cause. SENT and UNCERTAIN deliveries cannot be retried through this API.
- Approach messages expire after 15 minutes, delays after an hour, other events
  after 24 hours. Rules apply to future events; enabling a rule does not replay
  events already consumed while it was disabled.
- The Railway process scheduler runs the worker every minute. The authenticated
  job endpoint is `/api/jobs/run?job=bus-rider-notifications`; `dryRun=true`
  makes no claims or sends. Standalone Vercel deployments must schedule both
  outbox publication and this worker explicitly.

### Validation and remaining release gates

Local unit, TypeScript, schema, runtime-DDL and tenant policy checks cover this
increment. The workflow includes a separate fresh PostgreSQL 16 service for six
real RLS / locking / claim tests. It has not run in this workspace because no
PostgreSQL server is installed; installing one failed at the package source.
No production database or actual passenger channel was used.

Before release: run that PostgreSQL CI job, apply both migrations to isolated
staging, and validate the full event → consumer → worker flow with synthetic
riders and controlled transports. Then configure each tenant's channels and
rules. Delivery receipts, passenger channel preferences and provider-specific
WhatsApp approved templates are not implemented by this increment. Delayed
trip publishing still depends on ETA polling.

The event contracts, registry entries, `NotificationEvent` enum values,
and `TripNotificationDispatchConsumer` for the full trip-lifecycle event
set are shipped. Three publishers already fire in the trip lifecycle
endpoints:

| Event | Publisher | Status |
|---|---|---|
| `trip.cancelled` | [/api/bus-ops/schedules/[id]/cancel](../src/app/api/bus-ops/schedules/[id]/cancel/route.ts) | ✅ live |
| `trip.departed` | [/api/bus-ops/schedules/[id]/depart](../src/app/api/bus-ops/schedules/[id]/depart/route.ts) | ✅ live |
| `trip.completed` | [/api/bus-ops/schedules/[id]/complete](../src/app/api/bus-ops/schedules/[id]/complete/route.ts) | ✅ live |
| `trip.arriving` | GPS approach / live ETA | Local publisher + recipient worker; acceptance pending |
| `trip.delayed` | Live ETA | Local outbox publisher; requires migration and polling |
| `vehicle.changed` | Schedule PATCH | Local outbox publisher; scheduled trips only |
| `driver.changed` | Schedule PATCH | Local outbox publisher; scheduled trips only |
| `boarding.missed` | GPS stop exit | Local attendance + recipient worker; acceptance pending |

The sections below are the original design notes. Their proposed trigger
locations and delivery instructions are superseded by the local implementation
status above; revisit them when completing recipient delivery and operational
acceptance.

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
