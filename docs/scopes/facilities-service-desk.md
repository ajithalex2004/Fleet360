# Scope: Facilities Management service desk

**Goal.** Let any employee or tenant occupant raise a facilities request (a broken AC,
a leak, cleaning, a move, access, pest control, a meeting-room setup). Route it to the
right in-house team or contractor, track it against an SLA, close it with evidence and
cost, and run planned maintenance on building assets.

**Approach.** Extend the existing *Service Tickets* module and its service-catalogue
engine rather than build a new module. About 70% of what a facilities desk needs already
exists. The work is mostly removing vehicle assumptions and adding a space hierarchy.

## 1. Users

| Role | Needs |
|---|---|
| **Requester** (any employee or occupant) | Raise a request in seconds (web, mobile, WhatsApp, email, QR code on the asset), see its status, rate the result |
| **FM helpdesk / triage** | One queue, categorise, assign, merge duplicates, chase SLAs |
| **Technician** (in-house) | Mobile job list, check-in on site, photos before and after, parts used, sign-off |
| **Contractor** (external) | Receive jobs, quote, update status, upload completion evidence and invoice |
| **FM manager** | SLA compliance, backlog, cost per site, contractor performance, PPM compliance |
| **Finance** | Approve quotes over threshold, match invoices, cost by cost centre |

## 2. What already exists and is reused

| Capability | Where it lives today | Fit for FM |
|---|---|---|
| Ticket lifecycle: Pending → Acknowledged → Assigned/Escalated → Resolved, bulk actions, history audit | `src/app/service-tickets`, `/api/service-tickets`, `service_tickets` table (tenant RLS) | ✅ as is |
| Service catalogue: categories → types, per tenant, with icon, tone, default priority | `service_categories`, `service_types`, `service_module_mapping` + `/admin/service-config` | ✅ as is |
| Versioned rules per type and scope: SLA, approval, ticketing, finance, automation, form fields | `service_rules` + `src/lib/service-config/resolvers.ts` | ✅ as is |
| Scope tree for rule overrides (company → …) | `service_scopes` (`level`, `parent_scope_id`) | ✅ reuse; add site / building levels |
| Custom form fields per type | `formFields` rule category + `custom_fields` JSONB | ✅ as is |
| Active SLA engine + overdue sweep job | `active-sla-engine.ts`, `/api/service-tickets/sla/sweep` | ✅ as is |
| Department routing (triage → teams) | `TICKET_DEPARTMENTS` | ⚠️ fixed list; make it configurable |
| WhatsApp intake with NLP classification | `/api/service-tickets/whatsapp-ingest`, `whatsapp-nlp-engine.ts` | ✅ retrain the classifier for FM categories |
| Public status tracking without login | `/track-ticket/[token]` | ✅ as is |
| CSAT surveys + analytics | `/service-tickets/csat`, `csat-analytics-engine.ts` | ✅ as is |
| Cost ledger per ticket | `cost-ledger.ts` | ✅ as is |
| Approvals inbox | `/approvals` | ✅ as is |
| Asset register with categories, `GENERAL` domain, movements, stock, BLE tags and zones, calibration dates | `/assets/*`, `asset_registry`, `asset_categories`, `stock_transactions` | ✅ use for building assets (AC units, lifts, generators) and spare parts |
| Shared places catalogue (sites, depots, warehouses, zones) with geometry | `/locations`, `spatial.places` | ✅ top of the space hierarchy |
| Work orders, estimates, quotations, invoices, job closure, PM plans | `/maintenance/*` | ⚠️ the maintenance request has an optional `vehicleId`, but screens and PM plans assume vehicles |
| Vendor management + quotation portal | `/vendors`, `/vendors/garage-portal` | ⚠️ built for garages |
| Audit log, notifications, multi-tenant isolation, Arabic/RTL | platform | ✅ as is |

## 3. Gaps to build

**G1 — Open the ticket API to catalogue-defined types (blocker).**
`/api/service-tickets` POST and GET only accept the 7 built-in `TicketType` values
(`route.ts:119`, `route.ts:188`), and `tenant_ticket_types` is keyed on them. The fix:
- validate against the tenant's `service_types.key` instead;
- keep the 7 as seeded system types;
- treat `TicketType` as `string` in the UI, with the readable-ID prefix taken from the type.

This one change is what turns the module into a general service desk.

**G2 — Space hierarchy.**
Site → Building → Floor → Room/Zone. The simplest version is a `places` hierarchy: add
`parent_place_id` and a `level` to `spatial.places`. Then:
- add `place_id` and `asset_id` columns to `service_tickets`;
- scope rules by building, e.g. a different SLA for the HQ tower.

**G3 — Vehicle-free tickets and work orders.**
- Hide vehicle and driver fields for FM types (the existing `vehicleRequired` flag).
- Let work orders target an `asset_id` or `place_id`.
- Add an "FM" view of `/maintenance/work-orders`, filtered by linked module.

**G4 — Planned preventive maintenance (PPM) for building assets.**
- PM plans that target asset categories, e.g. "all AC units: quarterly filter change".
- Calendar and meter triggers.
- Auto-generated work orders.
- PPM compliance % reporting.

**G5 — Contractors.**
- Generalise the garage portal into a contractor portal: trades, coverage sites, rate
  cards, insurance and trade-licence expiry.
- Contractors accept jobs, quote, and upload completion photos and invoices.
- Contractor performance on the same model as garage performance.

**G6 — Technician mobile.**
- Job list, check-in (geofence from `places`), photos, parts used from `stock_transactions`,
  and customer sign-off.
- Reuse the driver-app patterns (offline queue, mobile session) rather than build a new app.

**G7 — More intake channels.**
- **Email-to-ticket**: an inbound mail webhook, threading replies into comments.
- **QR codes** on assets and rooms that open a pre-filled public request form.
- **Self-service portal** for requesters: my requests, raise new, rate.

**G8 — Configurable teams and assignment.**
- Make departments tenant data rather than a constant.
- Auto-assignment by trade + building + shift.
- On-call rota for out-of-hours P1s.

**G9 — FM reporting.**
- SLA compliance by category, site and contractor.
- Backlog ageing.
- Reactive vs planned ratio.
- Cost per m² / per site / per cost centre.
- First-time fix rate.

## 4. Starter catalogue (seed data, editable by tenant)

| Category | Types (default priority / response SLA) |
|---|---|
| Hard services | HVAC / AC fault (High, 4h) · Electrical (High, 4h) · Plumbing / leak (High, 2h) · Lift / escalator (Critical, 1h) · Fire & life safety (Critical, 1h) · Building fabric — doors, ceilings, glazing (Medium, 24h) |
| Soft services | Cleaning (Medium, 8h) · Pest control (Medium, 24h) · Waste removal (Low, 24h) · Landscaping (Low, 72h) |
| Workplace | Moves & furniture (Low, 72h) · Meeting-room setup (Medium, 8h) · Access card / keys (Medium, 8h) · Parking (Low, 24h) |
| Security & safety | Security incident (Critical, 1h) · Health & safety hazard (High, 2h) |

The SLA values are placeholders for each tenant to set. "Critical" needs a fourth priority:
today priority is `Low | Medium | High` (`route.ts:214`).

## 5. Phasing

| Phase | Delivers | Depends on | Relative size |
|---|---|---|---|
| **1. Configurable service desk** | G1, FM starter catalogue, Critical priority, configurable teams (G8 part) | — | M |
| **2. Where and what** | G2 space hierarchy, `place_id`/`asset_id` on tickets, building-level SLA scopes, QR request form | 1 | M |
| **3. Doing the work** | G3 vehicle-free work orders, G5 contractor portal, G6 technician mobile | 2 | L |
| **4. Planned maintenance** | G4 PPM on building assets, parts consumption | 3 | M |
| **5. Channels and insight** | G7 email intake + requester portal, G9 FM dashboards, auto-assignment and on-call | 1 (email), 3 (dashboards) | M |

Phase 1 alone gives a working internal facilities helpdesk on web and WhatsApp, with SLAs,
approvals, tracking links and CSAT.

## 6. Risks and decisions needed

- **Decision: who raises requests?** Employees only (needs SSO; that exists) or also building
  occupants and visitors (needs the public QR/portal path in Phase 2)?
- **Decision: priority model.** Add `Critical`, or switch to an impact × urgency matrix (ITIL style)?
- **Decision: contractor access.** A portal login per contractor, or email/WhatsApp-only
  updates for smaller vendors?
- **Risk: the catalogue tables have no RLS.** Per their migration, `service_types`,
  `service_rules` and `service_scopes` rely on app-layer tenant checks. New FM admin routes
  must keep the existing ownership checks (`ownsType`, `getScope`). Add a test per route.
- **Risk: department logic is hardcoded** in triage and forwarding. Phase 1 must migrate it to
  data without breaking existing fleet tenants. Keep the current 6 as system defaults.
- **Risk: vehicle-shaped UI.** Many maintenance screens assume a vehicle. Phase 3 should add an
  FM view rather than retrofit every fleet screen.
- **Not in scope:** energy/BMS integration, space booking and occupancy sensors, lease and
  property accounting, CAD floor plans. Each is a candidate follow-on once Phase 2 is in place.
