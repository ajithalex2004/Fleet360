# Item 2 — dispatcher disruption response

Builds the agreed workflow: breakdown → inspected substitute bus/driver → revised destination arrival → affected-rider update → audited response completion.

## Dispatcher workflow

Open Bus Ops → Trip Monitor → trip details → Disruption response. Report a breakdown with location and severity. A report creates a linked Bus Ops incident and preserves the original vehicle, driver and planned arrival. While REPORTED, departure and GPS-based stop/attendance automation are blocked; ETA returns an explicit disrupted state. This does not change the trip lifecycle status or erase passenger attendance.

Select a substitute bus or driver, enter the revised destination arrival and recovery notes, and complete all ten inspection results. Recovery serializes on the trip and substitute resources, checks tenant ownership, known sufficient capacity, active/compliant resources and overlapping assignments, then records a new inspection and changes the assignment and estimated arrival atomically. The trip's original departure and arrival deadline remain unchanged. A running trip retains its lifecycle status and passenger records.

Confirm response completion with a required outcome note. The linked incident is resolved; the response history retains both resource snapshots, inspection, actor and timestamps. An unrecovered response may be closed only if the trip was cancelled through its existing cancellation command.

## Isolation and delivery guarantees

- Explicit `approve:trips` writes and `view:trips` reads use authoritative tenant/session/module guards. Client tenant IDs, actors and status fields are rejected.
- Report request keys deduplicate identical retries; changed payloads conflict. Expected versions reject stale recovery/closure commands. One open response per tenant/trip is enforced by a partial unique database index.
- The parent trip tenant column is UUID in the tracked migrations; its Prisma declaration and the new child use UUID consistently. Composite tenant/trip FK and FORCE RLS protect `bus_trip_disruptions`. Required audit and durable outbox writes share the business transaction; failure rolls back the command.
- `trip.disruption_updated` is one consolidated message per workflow phase using the Item 1 delivery engine. It targets active CONFIRMED/BOARDED riders and rechecks phase freshness before fanout and transport. Superseded phase events and pre-breakdown approach/departure/delay messages during an unrecovered report are suppressed.
- Notification rules remain opt-in. Disabled rules do not send. Provider acceptance is not a delivery receipt. The history shows queued, accepted, blocked, failed and uncertain outcomes without exposing contact details.
- GPS uploads recheck the current vehicle/trip binding after acquiring the trip lock; ETA uses only the currently assigned vehicle's telemetry.

## Validation

Local selected regression gates: 474 passing tests across 12 suites. TypeScript, Prisma schema validation, runtime-DDL guard, tenant route check, tenant schema check and whitespace check pass. The authorization matrix was regenerated for the two new route templates.

A new isolated PostgreSQL CI job tests seven database cases: FORCE RLS, composite parent ownership, concurrent open-response uniqueness, trip-row serialization, cross-trip request-key uniqueness, transaction rollback and mandatory recovery/closure evidence. It requires a fresh localhost `fleet360_disruption_test` database and never uses staging/production credentials or outbound transports. Real database results are pending publication/CI when this record is written; the unit tests do not establish live database or browser acceptance.

Before staging deployment, apply `20261004100000_bus_trip_disruptions`, regenerate the Prisma client and verify application-role grants. Use an isolated database and synthetic contacts with outbound notification quarantine. Validate substitute recovery during a running trip, concurrent dispatcher requests, audit/outbox failure rollback, passenger attendance retention and disabled/blocked delivery behavior. Railway authorization remains unavailable, so staging and browser acceptance are incomplete. No production deployment, main merge, live passenger send, or repair-status update to the fleet asset is part of this change.
