# Scope: Fleet360 Field Service Management (Fleet360 FSM)

> Manage service requests, technicians, scheduling, dispatch, field execution, assets,
> maintenance, SLAs and customer service from one platform.

**Who it's for.** Companies that deliver services on site: air-conditioning maintenance,
electrical, plumbing, lift maintenance, cleaning, technical support. Also internal
facilities teams (see `facilities-service-desk.md`, whose Phase 1 FSM builds on).

**Decisions confirmed 2026-11-24** (§9): employee technicians only · separate Technician
app · time-and-materials **and** fixed-price, with call-out fees · per-job **and** monthly
consolidated invoicing · customer self-booking from launch · advisory zone-based
territories · email and API intake at launch · invoices only (no online payment) ·
Technician app by direct download · customers choose priority, Critical included.

**Principle.** FSM connects capabilities Fleet360 already has. It doesn't duplicate them.
Each reuse claim below was checked against the code (§4). Where the existing piece was
built for vehicles and drivers, the scope says what has to change for technicians.

---

## 1. Lifecycle coverage

| # | Stage | What FSM does | Built on | Phase |
|---|---|---|---|---|
| 1 | **Customer service request** | Intake from customer portal, mobile app, WhatsApp, **email and API at launch**; call centre later. Duplicates are detected. | Booking Portal service requests ✅, WhatsApp ingest + NLP ✅, tracking links ✅. **New:** email-to-ticket, public intake API (FSM-1); call-centre quick-log (FSM-5) | FSM-1 |
| 2 | **Service ticket & work order** | Categorise (catalogue), identify the asset and site, set priority and SLA, check contract or warranty entitlement, create the work order | Service catalogue, priorities and SLA ✅ (Phase 1). **New:** generalised work orders, asset/site linkage, entitlement check | FSM-1 |
| 3 | **Planning & scheduling** | Match skills, certifications, availability, location, zone and required parts and tools. Customers book their own appointment windows from launch. | **New:** technician profiles, calendars, zones; slot-booking engine; parts reservation over Assets stock ✅ | FSM-2 |
| 4 | **Intelligent dispatch** | Recommend the best technician or team, optimise routes, manage appointments, pre-empt for emergencies | Dispatch engine `TECHNICIAN` job type ✅, 15-factor optimiser ✅, routing travel times ✅, 2-opt route optimiser ✅ — **extended** for FSM factors (§5) | FSM-2 |
| 5 | **Mobile field execution** | Job details, navigation, geofenced check-in, checklists, photos, parts and time, notes | **New separate Fleet360 Technician app**, sharing the Driver App's libraries (auth, offline queue, GPS, OCR) ✅ | FSM-3 |
| 6 | **Customer confirmation** | Digital signature, service report, ePOD, feedback | ePOD rule category ✅, CSAT ✅, S3 storage ✅. **New:** signature capture, report PDF | FSM-3 |
| 7 | **Billing & closure** | Time-and-materials or fixed-price tasks, call-out fees, materials, expenses, warranty and contract offsets, then a per-job or monthly consolidated invoice | Ticket cost ledger ✅, `upsertFinanceInvoice` + mirror pattern ✅, VAT, credit notes, AR ✅. **New:** service-job mirror, entitlement-aware pricing | FSM-4 |
| 8 | **Analytics & performance** | SLA compliance, first-time fix, utilisation, cost and margin, CSAT | Reporting + CSAT analytics ✅. **New:** FSM KPIs and dashboards | FSM-5 |

## 2. Module architecture (menu)

| Menu | Purpose | Built on / new | Phase |
|---|---|---|---|
| **FSM Dashboard** | Live operations: open jobs, at-risk SLAs, technicians on map, today's KPIs | New page over existing data | FSM-2 (basic) → FSM-5 (full) |
| **Service Requests** | Customer-facing intake and complaints from every channel; requester sees status | Booking Portal service requests + WhatsApp ✅; email + API new (FSM-1); call centre (FSM-5) | FSM-1 |
| **Service Tickets** | Internal triage: categorise, de-duplicate, route to departments, escalate | Service Tickets ✅ + Phase 1 (catalogue types, Critical, departments) | ✅ / FSM-1 |
| **Work Order Management** | Create, plan, assign, track and close work orders for a site, asset or vehicle; multi-visit; on-hold reasons | Maintenance work orders, generalised | FSM-1 |
| **Planning & Scheduling** | Technician calendars (day / week), appointment windows, capacity, drag-to-assign, conflict warnings, **customer self-booking of slots** | New board + slot engine; availability data from Workforce | FSM-2 |
| **Dispatch & Route Optimization** | Location-aware recommendations, emergency pre-emption, daily route sequencing | Dispatch engine + optimiser + route optimiser, extended (§5) | FSM-2 |
| **Technician & Workforce Management** | Employee technicians: profiles, skills, certifications and expiry, teams/crews, home zones, shifts, leave, rate cards | **New.** Today's "workforce" covers drivers only (shifts, hours of service, training); patterns reused | FSM-1 |
| **Mobile Workforce** | **Fleet360 Technician** — a separate app: today's jobs, navigate, check-in, checklists, evidence, parts, time, signature, offline | New Capacitor app (`com.fleet360.technician`) on libraries shared with the Driver App | FSM-3 |
| **Inventory & Spare Parts** | Warehouses, van stock, reservations per work order, usage, returns, reorder | Assets stock + `field_dispatch` + technician stock ✅; reservations and reorder new | FSM-2 / FSM-4 |
| **Asset & Equipment Management** | Customer equipment register per site, service history, QR tags, warranty dates, meter readings | Asset register ✅ (`GENERAL` domain, categories, BLE tags); site link and history view new | FSM-1 |
| **Preventive Maintenance** | Recurring service plans and inspections by asset or contract; calendar and meter triggers; auto work orders | Preventive-maintenance agent + slot optimiser ✅ (vehicle OEM schedules); generalise to assets | FSM-5 |
| **SLA & Escalation Management** | Response and resolution targets by priority and contract; breach prediction; multi-level escalation | Ticket SLA engine + sweep ✅, workflow SLA levels ✅, escalation matrix in ticketing rules ✅; contract SLAs new | FSM-1 → FSM-5 |
| **Contracts & Warranty** | Service agreements, entitlements, included visits, coverage, warranty periods, price lists | **New** | FSM-4 |
| **Digital Inspection & ePOD** | Configurable checklists, photos, readings, signatures, PDF service report | Form-fields engine ✅ (reused for checklists), ePOD rule category ✅, S3 storage ✅ | FSM-3 |
| **Service Billing & Costing** | Time-and-materials **and** fixed-price tasks, call-out fees and minimums, materials, expenses, warranty/contract offsets; per-job **or** monthly consolidated draft invoices; billing review | Cost ledger ✅ + Finance module ledger ✅; job mirror + consolidation new | FSM-4 |
| **Knowledge Base** | Procedures, troubleshooting guides, manuals by asset model and fault; suggested articles on the job | **New.** The existing "vehicle knowledge base" is only a make/model lookup; the AI agent framework supports a later assistant | FSM-5 (+ AI in FSM-6) |
| **Reports & Analytics** | SLA compliance, first-time fix, utilisation, travel vs wrench time, repeat visits, cost and margin, CSAT, PM compliance | Reporting + CSAT analytics ✅; FSM KPIs new | FSM-5 |
| **Configuration & Automation** | Service catalogue, SLA rules, checklists, dispatch rule weights, zones, price lists and fixed-price task catalogue, call-out fees, billing modes, booking-slot rules, notification templates, workflows, integrations | Service Configuration Engine ✅, `/admin/workflows` ✅, email templates ✅, integration configs ✅; FSM settings added | Throughout |

## 3. Roles (RBAC)

The RBAC engine (`/admin/roles`, `src/lib/authz/policy-matrix.ts`) exists but has **no FSM
roles yet**. New roles:

| Role | Can |
|---|---|
| **Dispatcher** | Plan and assign visits; override recommendations (reason required); re-plan |
| **Technician** | See own jobs; execute, record evidence, parts and time; read the knowledge base |
| **Field supervisor** | All of a technician's rights for their team; approve overtime and on-hold; quality checks |
| **Service manager** | Contracts, SLAs, reports, pricing approvals |
| **Stores keeper** | Van loading, reservations, returns, reorder |
| **Customer (portal)** | Raise requests, book their own appointment slots, see their sites, equipment, reports and invoices |

Technicians are **employees only** (decision 1). Subcontractor access is out of scope; the
vendor/garage portal stays as it is.

## 4. Reuse — verified against the code

| Platform capability | What the code has today | Verdict for FSM |
|---|---|---|
| Multi-tenant architecture | Tenant-scoped tables with Postgres RLS (`tenant_isolation`), `withTenantRls` | ✅ Reuse. Every new table gets RLS plus an isolation test. *Customer* separation within a tenant needs a `customer_id` scope for portal users. |
| IAM and RBAC | Roles admin, policy matrix, SSO | ⚠️ Engine yes, FSM roles no (§3) |
| Booking and dispatch | `dispatch_jobs`, a `TECHNICIAN` job type with `requiredSkills` matching `drivers.skill_tags`, 15-factor Smart Dispatch Optimiser, AI auto-assign UI | ⚠️ Strong base, but candidates are drivers and vehicles. It has no job duration, certification expiry, parts, zone weighting or appointment-window constraints (§5). |
| GPS / location | Telematics heartbeat, offline telemetry queue, geofences, `spatial.places` (including `OPERATIONAL_ZONE` places), `RoutingIntelligenceService` travel matrix | ✅ Reuse for technician tracking and arrival checks, and the operational zones as service zones (decision 6) |
| Workforce management | Driver shifts, hours of service and fatigue, driver training and performance; `StaffMember` is staff-transport passengers | ❌ No technician workforce. Build profiles, skills, teams, calendars, leave and zones using the driver patterns. |
| Workflow infrastructure | `src/lib/workflow/*` (approvals, levels, SLA, inbox, decision links), `/admin/workflows` | ✅ Reuse for quote approval, overtime and on-hold approvals |
| Notifications | `notifications.ts`, `notification-delivery.ts`, email templates, push subscriptions, WhatsApp | ✅ Reuse for on-the-way, reminders and reports |
| Object storage | `src/lib/storage` (S3 config, file access, type checks, stored paths) | ✅ Reuse for photos, signatures and report PDFs, keeping its hardening |
| Reporting | Reports module, CSAT analytics, finance reporting | ✅ Reuse; add FSM KPIs |
| AI / RAG | LLM agent framework with governance (dispatch-optimiser, route-optimiser, preventive and predictive maintenance, incident-triage, ops-assistant, document intelligence) | ⚠️ Agents yes; **no RAG/vector retrieval exists**. Knowledge-base search starts as full-text; AI suggestions later (FSM-6). |
| Mobile application | Driver App: Capacitor app `com.fleet360.driver` (`out/driver`), auth, shifts, trips, DVIR, OCR, SOS, offline queue, OTA updates | ✅ Reuse the **libraries**, not the app: the separate Technician app (decision 2) shares auth, the offline queue, telemetry and OCR as common modules, with its own Capacitor project, bundle id, build output and OTA channel |
| Route optimisation | Route-optimiser agent: nearest-neighbour plus 2-opt sequencing with time windows (used for bus and logistics routes) | ✅ Reuse to sequence a technician's daily visits |
| Preventive maintenance | PM agent with OEM schedules, forecaster and slot optimiser (vehicles) | ⚠️ Generalise from vehicle schedules to asset and contract plans |
| Finance | `upsertFinanceInvoice` with mirrors for leasing, rental, logistics and maintenance; VAT, credit notes, AR, collections | ✅ Add `mirrorServiceJobToFinance` |

## 5. Intelligent Technician Dispatch (differentiator)

For each visit the engine works in three steps:
1. **Filter** out anyone who fails a hard constraint.
2. **Score** the remaining candidates.
3. **Explain** why the top candidates were recommended.

| Factor | Type | Data source |
|---|---|---|
| Skills and certifications | **Hard** (must hold every required skill; certification valid on the visit date) | `technician_skills` (level, expiry); required skills from the work order or catalogue type |
| Availability and working hours | **Hard** (window fits shift minus leave and booked visits, including travel) | `technician_availability`, booked `work_order_visits` |
| Service zone | **Advisory (scored)** — same zone as the job scores higher; out-of-zone technicians stay eligible (decision 6) | Technician home/covered zones → `spatial.places` `OPERATIONAL_ZONE`; extends the existing same-zone bonus in `src/lib/dispatch/scoring.ts` |
| Customer appointment window | **Hard** | Visit window from booking |
| Required tools and spare parts | **Hard** if the part is critical and not obtainable before the window; otherwise scored | Van stock, warehouse stock, tool register on the technician or van |
| Current location, distance and travel time | Scored | Live GPS or last job's site, `RoutingIntelligenceService` travel matrix |
| Workload | Scored (balance across the team, avoid overtime) | Booked hours today and this week |
| Priority and SLA deadline | Scored, with emergency pre-emption | Ticket priority and SLA target, contract SLA |
| Customer preference and continuity | Scored (same technician as last visit, preferred or blocked technician) | Visit history, customer settings |
| First-time-fix likelihood | Scored (later: learned) | Skill level, model-specific history |

**How it rolls out:**
- **Rules first:** weighted scoring with weights set per tenant in Configuration (including
  how much the zone match counts). Every
  recommendation shows its reasons ("2 km away, holds HVAC-L2, has the compressor part, 3 h free").
- **Team dispatch:** for jobs that need a crew (e.g. lift work needs two people), the
  engine picks a lead plus helpers who meet the combined skill set.
- **Emergencies:** a Critical job can propose pre-empting a lower-priority visit. The
  dispatcher confirms, and the displaced customer is notified and offered a new window.
- **Daily route:** after assignment, the route optimiser sequences each technician's day
  within the appointment windows, and re-plans when a job overruns.
- **AI later (FSM-6):** once there is enough history, learned models adjust predicted job
  duration, first-time-fix likelihood and weights. They're recommended only, always
  overridable, and every override and reason is logged for learning.

This extends `src/lib/dispatch` (eligibility and scoring) with technician candidates rather
than replacing it. Driver and vehicle dispatch is untouched.

## 6. Capability detail by phase

### FSM-1 — Foundations (requests → tickets → work orders, people and assets)
- **Intake (launch channels: email and API, decision 7):**
  - email-to-ticket (per-tenant inbound address via a mail webhook; sender matched to a
    customer and site; replies thread into ticket comments; attachments to storage);
  - a public intake API (REST, per-tenant API keys, scopes, rate limits, idempotency keys,
    webhooks back for status changes; documented with OpenAPI);
  - duplicate detection (same site and equipment, open ticket).
- **Work orders:** target a site, asset or vehicle; tasks; required skills, parts and
  tools; estimated duration; multiple visits; on-hold reasons (parts, customer, access,
  approval).
  - **Fix:** `POST /api/work-orders` currently spreads the request body into
    `workOrder.create`. Use an allowlist.
- **Technician & Workforce:** employee technicians only. Profiles, skills and
  certifications with expiry alerts, teams and crews, home and covered zones (operational
  zones), shifts and leave, rate cards, a user link (and a driver link where they also drive).
- **Assets & sites:** customer sites over `spatial.places`; equipment in the asset
  register, linked to a site; service history; QR tags that open a pre-filled request.
- **SLA:** response and resolution targets already exist per type and priority (Phase 1).
  Add response tracking (first acknowledgement and arrival) and escalation levels
  through the existing escalation matrix.
- **RBAC:** FSM roles (§3).

### FSM-2 — Planning, scheduling and dispatch
- Planning board: day or week calendar per technician, unassigned queue by SLA risk, map,
  drag-and-drop, conflict warnings.
- **Customer self-booking from launch (decision 5):** the portal and the intake API offer
  available slots, worked out from technician calendars for the required skill, the job's
  estimated duration, travel time and zone. Rules per service type control lead time,
  window length and how far ahead customers can book. A booked slot is held, and
  confirmed when the recommendation engine assigns a technician; otherwise the
  dispatcher is alerted.
- **Customer-selected priority (decision 10):** customers choose **Critical, High,
  Medium or Low** in the portal and API, each with a plain description (e.g. Critical =
  "safety risk, flooding, people trapped, total outage"). The choice drives the SLA and
  the booking flow:
  - **Low / Medium / High:** pick an appointment slot (High is offered the earliest slots).
  - **Critical:** the slot picker shows **only the current hour**. The customer picks a
    time within it, e.g. 14:15–15:00 when booking at 14:12; no later slots are offered.
    - The job is **not auto-assigned**. It goes straight to the dispatcher queue as an
      **emergency**: pinned to the top of the planning board, with an alert sound and
      banner.
    - The **on-call dispatcher is alerted at once** by push, SMS or WhatsApp. If nobody
      acknowledges within the tenant's escalation time, the alert escalates to the next
      on-call contact or supervisor.
    - The dispatcher still sees the ranked technician recommendation (§5, including
      pre-empting a lower-priority visit) and confirms the assignment.
    - The customer sees "Emergency received — a dispatcher is arranging a technician"
      and is updated as soon as one is assigned, with an ETA.
    - If the chosen time within the hour can't be met, the dispatcher proposes the
      nearest feasible time; the customer is notified and the change is logged against
      the Critical SLA.
  - **Safeguards:**
    - Critical requires a short reason and a contact phone number.
    - Where the tenant sets one, the customer sees the emergency call-out charge before
      confirming.
    - Per-service rules can limit Critical to entitled contracts or disable it.
    - A dispatcher can re-grade the priority, with a reason that is shown to the customer
      and logged.
    - Repeated mis-grading by a customer is reported, not blocked.
- Intelligent dispatch (§5), team dispatch, emergency pre-emption.
- Daily route sequencing and live re-planning.
- Parts reservation against van or warehouse stock when the job is scheduled.
- A basic FSM dashboard.

### FSM-3 — Mobile field execution and customer confirmation
- **Fleet360 Technician app** (separate app, decision 2):
  - its own Capacitor project, bundle id (`com.fleet360.technician`), build output and
    OTA channel;
  - **distributed by direct download for now (decision 9):** a signed Android APK served
    from a tenant-authenticated download page, extending the existing
    `/api/mobile/download-apk` route with an app selector (driver / technician). The
    signing key is held outside the repo, versions are checked on launch, and OTA web
    updates come between APK releases. Store publishing stays possible later because the
    bundle id is reserved now. iOS needs an Apple distribution route if iPhones are
    required (see risks);
  - the Driver App's auth, offline queue, telemetry and OCR moved into shared modules
    used by both apps, so neither app forks them;
  - FSM roles only (technician, field supervisor).
- In the app:
  - today's route and navigation;
  - "on the way" (customer gets ETA and a live link);
  - geofenced check-in and check-out;
  - job and asset history; checklists (built on the form-fields engine);
  - photos before and after; meter readings; parts used from van stock; labour time;
    expenses (parking, materials bought with receipt OCR); notes and fix codes.
- Offline-first: queue, sync, and server-side conflict rules. An in-progress visit is
  locked to its technician.
- Customer confirmation: signature, an ePOD record, a PDF service report (email or
  WhatsApp), a CSAT survey.
- Knowledge Base on the job: articles suggested by asset model and fault code
  (full-text search).

### FSM-4 — Billing, contracts and warranty
- **Contracts & Warranty:**
  - service agreements: covered services, included visits, SLA overrides through a
    contract scope, price lists, billing mode (covered / chargeable / capped);
  - equipment warranty periods;
  - an entitlement check when a ticket is created.
- **Pricing (decision 3 — both models):**
  - *time and materials:* labour from time × rate card (normal, overtime, weekend),
    minimum billable time, rounding rules;
  - *fixed price:* a catalogue of fixed-price tasks per service type (e.g. "AC filter
    service — AED 150"); a work order can mix fixed-price tasks and T&M time;
  - *call-out fee:* per zone or service type, optional out-of-hours surcharge; waived
    or covered by contract where entitled;
  - materials at cost plus markup or price-list price; expenses at cost or with a handling fee;
  - warranty and contract offsets applied last.
- **Invoicing (decision 4 — provision for both):**
  - a billing mode on each customer, overridable per contract: **per job** (a draft
    invoice when the job completes) or **monthly consolidated** (completed jobs collect
    in a billing batch; one invoice per customer per period, one line group per job);
  - both go through `mirrorServiceJobToFinance` → `upsertFinanceInvoice` as **draft**
    VAT invoices, with a billing review queue;
  - contract fees through recurring invoices;
  - **invoices only (decision 8):** no online card or payment links. Customers receive
    the invoice (email and portal download), and payment is collected and matched through
    Finance's existing collections, payment reminders and AR ageing.
- **Inventory:** reorder points per van and warehouse, returns, stock-out reporting.

### FSM-5 — Preventive maintenance, knowledge and analytics
- **Preventive Maintenance:**
  - plans by asset category or contract;
  - calendar and meter triggers;
  - auto-generated work orders grouped by site so they can be planned together;
  - a compliance report.
- **Knowledge Base:**
  - articles, procedures and manuals, versioned;
  - linked to asset models and fault codes;
  - technicians can submit fixes that a supervisor approves.
- **Reports & Analytics:**
  - SLA response and resolution compliance; first-time fix rate;
  - technician utilisation (wrench, travel and idle time); jobs per day;
  - repeat visits within 30 days;
  - parts usage and stock-outs;
  - cost, revenue and margin by job, customer, contract and technician;
  - CSAT; PM compliance.
- Full FSM dashboard.
- **Call-centre intake** (deferred from launch, decision 7): caller lookup → site →
  equipment → ticket in one screen.

### FSM-6 — AI layer
- An AI dispatch advisor: learned duration, first-time-fix likelihood and weight tuning,
  starting from rules (§5).
- A troubleshooting assistant: retrieval over the Knowledge Base and service history.
  This needs a vector index that doesn't exist yet. It runs under the agent governance
  framework.
- Predictive maintenance for equipment, generalising the vehicle predictive agent.

## 7. Data model (new, all tenant-scoped with RLS)

| Area | Tables |
|---|---|
| Workforce | `technicians`, `technician_skills`, `technician_teams` + members, `technician_availability`, `technician_zones` (→ `spatial.places` operational zones), `tools` |
| Customers & assets | `customer_sites`, an asset-to-site link (on `asset_registry`), `asset_meter_readings` |
| Work | `work_orders` (generalised), `work_order_tasks`, `work_order_visits`, `visit_evidence` (photos, signature, checklist answers, readings), `visit_time_entries`, `visit_expenses` |
| Inventory | `stock_reservations`; reuse `field_dispatch`, `field_dispatch_items`, `personnel_stock`, `stock_transactions` |
| Commercial | `service_contracts`, `contract_entitlements`, `warranties`, `price_lists`, `rate_cards`, `fixed_price_tasks`, `callout_fees`, `customer_billing_settings` (billing mode), `billing_batches` (monthly consolidation) |
| Planning | `pm_plans` (generalised), `dispatch_rule_weights` (per tenant), `dispatcher_on_call` (on-call rota and escalation order), `emergency_alerts` (sent / acknowledged / escalated) |
| Knowledge | `kb_articles`, `kb_article_links` (asset model, fault code, service type) |
| Intake & booking | `inbound_email_threads`, `intake_api_keys`, `intake_webhooks`, `booking_slot_rules`, `slot_holds` |

## 8. Phasing summary

| Phase | Outcome | Size |
|---|---|---|
| **FSM-1 Foundations** | Email, API, portal and WhatsApp land requests; tickets become work orders against sites and assets; employee technicians, skills, teams and zones exist | L |
| **FSM-2 Plan & dispatch** | Customers book their own slots; dispatchers plan the day with explained recommendations and routes | XL |
| **FSM-3 Field execution** | Technicians work from the separate Technician app, offline; customers get ETA, signature, report and survey | XL |
| **FSM-4 Commercial** | Contracts, warranty and entitlements; T&M and fixed-price pricing with call-out fees; per-job or monthly consolidated draft invoices | L |
| **FSM-5 PM, knowledge & analytics** | Recurring maintenance, technical knowledge base, full KPI suite, call-centre intake | M |
| **FSM-6 AI** | Learned dispatch, troubleshooting assistant, predictive equipment maintenance | M |

An internal FSM (facilities and fleet technicians) is usable after FSM-3. A commercial
service business with contracts is usable after FSM-4.

## 9. Decisions (confirmed 2026-11-24)

| # | Question | Decision | What it changes in this scope |
|---|---|---|---|
| 1 | Technicians | **Employees only** | No subcontractor role or portal; technician records always link to a staff user |
| 2 | Mobile | **Separate app** | New Capacitor app `com.fleet360.technician` with its own release cycle; Driver App code shared as common modules, not copied. FSM-3 grows to XL. |
| 3 | Pricing | **Both T&M and fixed price, with call-out fees** | Rate cards, fixed-price task catalogue, call-out fees per zone or service type, mixed work orders |
| 4 | Invoicing | **Provision for both** | Billing mode per customer (overridable per contract): per-job draft invoice, or monthly consolidated batch |
| 5 | Self-booking | **Yes, from launch** | Slot engine and booking rules in FSM-2 (portal and API); slot holds confirmed on assignment. FSM-2 grows to XL. |
| 6 | Territories | **Advisory, based on zones** | Zones reuse `spatial.places` operational zones; zone match is a scored factor, never a filter |
| 7 | Launch intake | **Email and API** | Both in FSM-1; call-centre quick-log moves to FSM-5 |
| 8 | Payment collection | **Invoices only** | No payment gateway or links; collection through Finance (collections, reminders, AR ageing) |
| 9 | App distribution | **Direct download (for now)** | Signed APK from an authenticated download page (extends `/api/mobile/download-apk`); store publishing later |
| 10 | Customer priority | **Customers choose Critical / High / Medium / Low** | Critical offers slots in the **current hour only**, goes straight to the dispatcher queue as an emergency (no auto-assign), and alerts the on-call dispatcher immediately with escalation if not acknowledged; safeguards: reason, phone, call-out disclosure, dispatcher re-grade |

### Still open
None. All scope decisions are made; implementation-level choices are recorded per phase.

## 10. Risks

- **Three overlapping job records** (ticket, work order, dispatch job). Rule: the ticket
  is the *request*, the work order is the *job of record*, a dispatch job is one *assignment*.
- **Dispatch generalisation** must not regress driver and vehicle dispatch. Technician
  candidates go through a separate eligibility path, with regression tests on the existing one.
- **Offline conflicts:** server-side ownership rules and idempotent sync.
- **Two mobile apps:** the separate Technician app doubles release, store and support
  work. Mitigation: shared modules with one test suite, one OTA service, one release checklist.
- **Self-booking over-commitment:** slots must account for travel and job duration, and
  hold capacity for emergencies, or customers will book windows nobody can meet.
  Mitigation: per-service buffers and an emergency capacity reserve in booking rules.
- **Direct APK distribution:** devices must allow installs from unknown sources, there's
  no store-driven update, and **iPhones can't install an APK**. Mitigation: authenticated
  download, signature and version checks with a forced-update screen, OTA web updates,
  and device-management or TestFlight / Apple Business distribution if iOS technicians
  are needed.
- **Customer-selected Critical:** over-use would swamp emergency capacity. Mitigation:
  plain-language descriptions, call-out charge disclosure, contract entitlement rules,
  dispatcher re-grading with logged reasons, and a mis-grading report.
- **Intake API abuse:** it is a public surface. Per-tenant keys, scopes, rate limits,
  payload validation, and an entry in the public-route inventory test.
- **Billing correctness:** VAT, credit notes and entitlements are tested against Finance
  rules; invoices are drafts until approved.
- **Personal data:** photos, signatures and site details follow storage hardening and
  retention rules, and never appear on public tracking pages.
- **AI claims:** no AI recommendation without enough data and an explanation. Rules stay the fallback.

## 11. Not in scope

- Subcontractor technicians and a subcontractor portal (decision 1).
- Online payment / payment gateway (decision 8).
- App-store publishing (decision 9 — later).
- IoT / BMS-triggered work orders.
- AR remote assistance.
- Payroll.
- Supplier purchase orders beyond stores requests.
- A full VRP solver beyond daily 2-opt sequencing.
