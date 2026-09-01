# Staff Transportation Module (Bus Ops) — Functional Audit & Gap Analysis

**Date:** 2026-09-01
**Scope:** `src/app/(app)/bus-ops/**`, `src/app/api/bus-ops/**`, related Prisma models, and the two planning engines (PCE, RVE). Branch `railway-migration`.
**Method:** Direct code audit (pages, API routes, Prisma schema, engine source) — not a review of existing docs. Two pre-existing audit artifacts (`docs/testing/staff-transportation-test-inventory.md`, `.audit-reports/BUS-OPS-E2E-TEST-REPORT.md`) were checked against and found to be stale on specific counts; this document supersedes them for a current-state view.
**Author's stance:** written as a systems analyst mapping what exists and how it connects, and as a product manager judging what's missing against a mature staff-transportation product.

---

## 1. Executive summary

The module is substantially more built-out than its own historical docs suggest. It has two purpose-built planning engines (a write-time single-trip validator and a plan-time batch constraint evaluator), a fully-landed route consolidation and vehicle-reuse optimization suite (not just scaffolding), a real VRPTW fleet optimizer, and three separate end-user surfaces (operator web app, driver PWA, passenger PWA) plus a fourth driver surface in a separate React Native app. The core planning → dispatch → execution → billing loop is complete and internally consistent.

The gaps are not "missing features" in the greenfield sense — they're **product fragmentation and data-model debt** accumulated across what was clearly several independent build phases: two competing driver apps, two competing passenger apps, two differently-shaped transport-request models, and a trip-status vocabulary that was renamed in the canonical library but not fully propagated to every UI screen. There are also real *workflow* gaps — no shift/roster UI despite the underlying model existing, no proactive document-expiry visibility, no SMS fallback channel, and no closed loop from AI demand-forecast to trip creation.

---

## 2. Functional sequence map

The module runs as seven sequential phases, each depending on the ones before it. This mirrors the mind map rendered above; the numbering here matches it 1:1.

### Phase 1 — Setup & configuration
*Nothing downstream works until this phase is done at least once per tenant.*

1. **Routes, stops & variants** (`/bus-ops/routes`) — define the physical route network: origin, destination, ordered stops (with GPS + geofence radius), and named directional variants (e.g. "Morning → Office" vs "Evening → Residence"), each with immutable dated version snapshots so a route can change over time without breaking historical trip records.
2. **Geofences & BLE gateways** (`/bus-ops/geofences`, `/bus-ops/gateways`) — draw named zones (stop, garage, base camp, accommodation) on a map for automatic arrival/departure detection, and register the physical BLE hardware that reads passenger tags at those zones, including secret rotation for compromised devices.
3. **Transport calendars** (`/bus-ops/transport-calendars`) — define exception days (holidays, half-days, reduced service) that the schedule-template generator reads before materializing trips, so trips aren't created on days the office is closed.
4. **Planning rules** (`/bus-ops/planning-engine?tab=cba|constraints|headway`) — three rule sets that gate everything from Phase 3 onward: CBA/union operational rules (rest periods, overtime pay bands), the 14-kind PCE constraint catalogue (7 live evaluators + 6 config-only kinds — zone bans, capacity limits, detour limits, SLA windows), and headway rules (frequency-based departures instead of fixed timepoints).

### Phase 2 — Enrollment & demand capture
5. **Employee directory** (`/bus-ops/staff`) — the roster of staff eligible for transport, sourced from the central Workforce module.
6. **Passenger roster** (`/bus-ops/passengers`) — the standing assignment of employee → route, with a validity window and CSV bulk import for onboarding a whole site at once.
7. **Transport requests** (`/bus-ops/transport-requests`) — the intake queue for anything that isn't a standing assignment: ad-hoc rides, requested route changes, new-route asks, and temporary (leave-driven) changes, each requiring operator approve/reject.

### Phase 3 — Planning & optimization
*This is the heaviest phase — five distinct tools that all read the Phase 1 rules and Phase 2 demand.*

8. **Route planner** (`/bus-ops/route-planner`) — either optimize a single route's stop order (TSP) or run a full fleet assignment (VRPTW: which vehicle covers which stops, solved server-side, polled to completion, then published as real trips).
9. **Schedule templates** (`/bus-ops/schedule-templates`) — recurring weekly patterns that "Generate" turns into actual dated `TripSchedule` rows, skipping calendar exceptions from step 3.
10. **Planning engine — core** (`/bus-ops/planning-engine`, default tab) — the plan-time batch evaluator: pick a date range, compute a plan (driver duty blocks, vehicle rosters, cost), review PCE verdicts, and apply — a BLOCK verdict hard-stops the apply, a WARN lets the operator proceed with the risk surfaced.
11. **Route consolidation** (`/bus-ops/route-consolidation`) — network-design analysis asking "which pairs of active routes should be permanently merged into one," through a four-stage pipeline (cheap filters → real driving-distance matrix → PCE evaluation on the synthesized merge → weighted cost/operator scoring), with a full apply/revert lifecycle including passenger-enrollment migration.
12. **Vehicle/resource optimization** (`/bus-ops/vehicle-resource-optimization`) — a related but distinct analysis: can one vehicle sequentially cover two routes back-to-back instead of needing two vehicles. Advisory only — the operator manually re-assigns on Schedules.
13. **Demand forecast** (`/bus-ops/demand-forecast`) — a 4-week trailing-average baseline per route/shift/day, optionally annotated by an LLM call flagging over/under-capacity risk, with a manual "create trip" action per flagged row.

### Phase 4 — Day-of dispatch
14. **Trip monitor** (`/bus-ops/dispatch`) — the day's kanban board (Scheduled → Started → En route → Completed), with vehicle/driver assignment and stage advancement, auto-refreshing every 30s.
15. **Ad-hoc dispatch** (`/bus-ops/adhoc-dispatch`) — fulfills the Phase 2 ad-hoc queue in real time via a three-tier matcher: insert into a trip with spare capacity, spin up a standby shuttle, or fall back to a taxi voucher.
16. **Trip merge** (merge dialog on `/bus-ops/schedules`) — same-day, execution-time consolidation of two under-filled scheduled trips into one, PCE-gated, distinct from the permanent route consolidation in step 11.
17. **Driver app — pre-trip through completion** (`/bus-ops/driver`, PWA) — the driver's own device: mandatory pre-trip vehicle check (blocks departure if failed), depart/complete actions with odometer and fuel prompts, continuous GPS ingest while en route, and an in-trip passenger boarding grid.

### Phase 5 — Passenger experience
18. **Boarding check-in** — a single unified endpoint accepting QR (15-minute rotating HMAC token, driver-displayed or self-scan), NFC, BLE-tag proximity, or manual entry.
19. **Live map & GIS** (`/bus-ops/live-map`, `/bus-ops/gis`) — real-time vehicle positions on Google Maps, and a separate layered service-area planning view (routes, demographics, roads).
20. **SLA monitor & delay broadcast** (`/bus-ops/sla-monitor`) — live at-risk/breach feed against each trip's committed arrival time, with a one-click broadcast that pushes a delay notice to affected passengers.
21. **Passenger app** — trip status, live ETA, absence submission, and waitlist join for staff, on their own device.

### Phase 6 — Post-trip & back office
22. **Trip logs** — driver-entered mileage, fuel, and passenger-count records per completed trip, feeding cost analytics.
23. **Incident management** (`/bus-ops/incidents`) — accident/breakdown/delay/medical/complaint records with severity and police-report fields.
24. **Driver performance** (`/bus-ops/drivers`) — nightly-recomputed A–E scorecard from on-time %, incidents, fuel efficiency, and trip volume.
25. **Notifications** — delay/cancellation/route-change/reminder broadcasts to passengers (WhatsApp + email), plus an alert-engine path for SLA breaches and ad-hoc request status.

### Phase 7 — Analytics & finance
26. **Operations analytics** (`/bus-ops/analytics`) — completion rate, on-time SLA, cost per trip/passenger/km, boarding-method adoption, trend and peak-hour charts.
27. **Cost allocation** (`/bus-ops/cost-allocation`) — pro-rata recharge of transport cost across internal departments by passenger-km or actual boarding activity, with a "post to GL" action creating draft journal entries.
28. **Power BI export** (`/bus-ops/powerbi`) — a documented Web-connector contract exposing trip and route fact tables for external BI.

### The two engines every phase above leans on
- **RVE (Resource Validation Engine)** — write-time, single-assignment check run whenever a trip's vehicle/driver/time is set: 15 checks covering vehicle availability/type/capacity/document-expiry and driver availability/shift/license, wrapped in advisory locks to close the check-then-write race.
- **PCE (Planning Constraint Engine)** — plan-time, batch check run by every "apply" action across steps 10, 11, and 16: 7 live evaluators (zone restrictions, pickup-time buffers, trip duration, detour distance, merged-arrival SLA, stop restrictions, capacity) rolled up to a single BLOCK/WARN/PASS verdict per affected trip, shown through one shared `PceVerdictPanel` component everywhere it's used.

---

## 3. Functionality gap analysis

Ranked by how directly each gap threatens data correctness or operator trust versus how much it's a product-completeness nice-to-have.

### 3.1 Data-integrity gaps (fix first)

**G1 — Trip status vocabulary is split across two names.** The canonical status enum (`state-machines.ts`) is `SCHEDULED → STARTED → EN_ROUTE → COMPLETED/CANCELLED`, with a legacy-mapper for old values. But the Schedules page's status filter/colors and the module dashboard's "active trips" count still hard-code the legacy `DEPARTED`/`IN_TRANSIT` strings. Any trip currently sitting in `STARTED` or `EN_ROUTE` will silently fail to show as "active" on the dashboard or be filterable on the Schedules page. This is a live bug, not a documentation artifact — confirmed by direct code reading, not by trusting the prior audit that flagged it.

**G2 — Two shaped-differently transport-request models.** `StaffTransportRequest` (wired to the `/bus-ops/transport-requests` UI and the ad-hoc dispatch engine) and a second `TransportRequest` model with its own enums exist side by side. Unclear which, if either, is dead. Left unresolved, this is exactly the kind of duplicate-schema trap the team has already been burned by once this session (the `pre-verify-domain` and `super-admin` bugs both came from code not matching the model it was actually supposed to use).

**G3 — Two independent driver apps.** The web PWA at `/bus-ops/driver` and a full separate React Native app (`mobile-app/src/app/driver-app`) with its own API prefix (`/api/driver-app/**`, 26 routes covering shift, DVIR, fuel, expenses, behavior events) both serve the same driver persona. Either they're meant to coexist for different fleets/regions (in which case that split should be documented and enforced), or one is legacy and should be sunset — right now a driver's shift/DVIR/expense history could exist in one surface and be invisible in the other.

**G4 — Two independent passenger apps.** Same shape of problem: the `passenger/**` PWA (3-tab, its own layout) and `passenger/app/page.tsx` (a second, self-contained PWA shell with its own service worker and push-subscribe flow) both exist and are both linked from the dashboard.

### 3.2 Operational workflow gaps

**G5 — No driver shift/roster management UI.** `DriverShift` is a real Prisma model (consumed read-only by RVE's D3 check), but no page in the module lets an operator create or edit shifts. Today shifts must be seeded some other way, which likely means RVE's "driver has no shift" warning is either always firing or silently bypassed depending on how shifts actually get populated.

**G6 — No driver training/certification UI.** `DriverTraining` exists as a model with no visible CRUD surface — compliance tracking for driver certifications has no operator-facing home.

**G7 — No proactive document-expiry dashboard.** RVE checks vehicle registration/insurance/Mulkiya and driver license expiry, but only reactively, at the moment someone tries to assign that vehicle or driver to a trip. There's no forward-looking "these 6 vehicles expire within 30 days" view — the kind of thing that turns into a same-day operational scramble instead of a planned renewal.

**G8 — Pre-trip check failures have no resolution workflow.** `BusPreTripCheck` → `DvirDefect` blocks a driver from departing, which is correct, but there's no visible defect-tracking/resolution screen for maintenance/ops to clear a defect and unblock the vehicle — it's unclear from the audit whether this loop closes anywhere in bus-ops or silently depends on the separate Maintenance module.

**G9 — Demand forecast doesn't close the loop.** The AI-annotated forecast flags over/under-capacity risk with a "create trip" button, but that's a manual click-through, not an automated recommendation-to-draft-plan pipeline into the Planning Engine (step 10). For a feature explicitly built with an LLM call, stopping at "here's a risk, go handle it yourself" leaves the highest-value part (turning the forecast into a ready-to-review plan) undone.

### 3.3 Communication gaps

**G10 — No SMS fallback.** All passenger notifications go through WhatsApp and email (or push, for the newer passenger app). Staff without a smartphone or WhatsApp account — a real population in blue-collar transport contexts — have no channel for delay/cancellation alerts.

**G11 — No notification-preference center.** Passengers can't choose which channel they want or opt out of non-critical pings; it's all operator-triggered broadcast with no per-user control.

### 3.4 Financial/compliance gaps

**G12 — Cost allocation stops at draft journal entries.** The recharge engine correctly pro-rates cost and posts to GL, but there's no visible invoice-generation or dispute/adjustment workflow if a department wants to contest its allocated share.

**G13 — No emergency/evacuation workflow.** Incident management captures what happened after the fact; there's no in-app "trigger emergency response" action (notify all guardians/HR contacts, dispatch nearest response vehicle) distinct from the generic incident log.

### 3.5 Product-completeness observations (lower priority, worth roadmap discussion)

- No employee-side satisfaction/feedback loop on trip quality.
- Driver performance scoring uses trip-level aggregates (on-time %, incidents, fuel, volume) but doesn't appear to ingest granular telematics events (harsh braking, speeding) even though a separate CAN-bus telematics engine exists elsewhere in the fleet product — a natural, currently-unrealized integration.
- No weather/road-disruption contingency planning surface (manual rerouting only, via the driver's live map).
- Route consolidation and vehicle-reuse are both read-only recommendation engines with human-triggered apply — appropriate for a first release, but there's no scheduled/automatic re-analysis cadence (e.g. "re-run consolidation analysis weekly and surface new opportunities") visible in the audit.

---

## 4. Recommended sequencing

1. **G1 immediately** — it's a one-line-per-file string fix (align Schedules page and dashboard filters to the canonical status enum) with real user-facing impact and near-zero risk.
2. **G2–G4 as a scoped spike** — before building anything new, get a definitive answer on which of the duplicate models/apps is canonical, document the decision, and either sunset or explicitly partition the other.
3. **G5–G8** as the next feature slice — they're gaps in an otherwise-complete operational loop, not new product surface.
4. **G9–G13** as roadmap items, prioritized against actual customer complaints once G1–G8 are closed.

---

*This document was generated by direct code audit on 2026-09-01. Re-verify counts and gap status before relying on it beyond this date — the team's own prior audits in this repo went stale within weeks of being written, and this one is not exempt from that risk.*
