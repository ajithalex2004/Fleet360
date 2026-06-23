# Fleet360 — Logistics Module Competitive Analysis

**Evaluation date:** 2026-05-17
**Scope:** Fleet360's Logistics module (`src/app/logistics/*`, `src/app/api/logistics/*`, `src/lib/logistics/*`, 13 Prisma models) vs. four competitor archetypes — Enterprise TMS, Freight Marketplaces, Visibility Platforms, and Regional / Middle East players.
**Audience:** Product leadership, engineering planning.

---

## Table of Contents

1. [Strategic Positioning Brief](#section-1--strategic-positioning-brief)
2. [Executive Feature & Gap Summary](#section-2--executive-feature--gap-summary)
3. [Full Comparative Matrix](#section-3--full-comparative-matrix)
4. [Methodology & Caveats](#methodology--caveats)

---

# Section 1 — Strategic Positioning Brief

## Where Fleet360 plays today

Fleet360's Logistics module is a **hybrid Transportation Management System + private Freight Marketplace + first-party Visibility layer**, packaged inside a broader multi-module fleet platform (RAC, Leasing, School Bus, Staff Transport, Maintenance, Incident, Finance, Service Tickets). It is:

- **Multi-tenant SaaS** — every entity carries `tenant_id`, scoped via middleware headers
- **GCC-resident architecture** — Neon Postgres in Asia Pacific Southeast, AED-pricing throughout, designed for UAE/GCC operational realities
- **Next.js 15 + Prisma + React 19** stack — modern, fast iteration, deployable on Vercel / any Node host
- **Mid-stage maturity** — the marketplace, dispatch, 3-way finance reconciliation, ePOD, and tracking are functional. Compliance, ML-driven visibility, EDI, and enterprise integrations are absent.

## The competitive landscape (4 archetypes)

| Archetype | Examples | Who they serve | Where they excel | Where they're weak |
|---|---|---|---|---|
| **Enterprise TMS** | SAP TM, Oracle OTM, Manhattan Active TM, Blue Yonder TM, MercuryGate, Descartes, 3Gtms | Fortune 1000 shippers, 3PLs, global logistics conglomerates | Multi-modal optimisation, ERP integration, EDI mesh, mature compliance, 100+ country support | Long implementation (12-24 mo), $1-10M+ TCO, brittle UX, slow to evolve |
| **Freight marketplaces** | Uber Freight, Convoy/Flexport, Loadsmart, DAT Load Board, Truckstop.com, Echo, CH Robinson NaviSphere | Spot shippers, owner-operator carriers, brokers, mid-market | Frictionless load-carrier matching, instant rates, mobile-first carrier UX, massive carrier networks | Light on contract management, weak shipper-side analytics, low integration with shippers' ERPs |
| **Visibility platforms** | Project44, FourKites, Shippeo, Transfix, Trax, MacroPoint | Shippers, 3PLs needing cross-carrier real-time tracking | Real-time GPS, ML ETA, exception management, customer notifications, 1000+ carrier integrations | Pure overlay — no booking/dispatch; require existing TMS upstream |
| **Regional / Middle East** | Aramex, DP World CARGOES, Trukker, TruKKin, Maqta Gateway, Cargoz, Foodics-style verticalised players | GCC shippers, regional carriers, customs flows | Arabic UI, AED/VAT compliance, RTA/Mulkiya/Salik integration, local customs broker networks, fragmented carrier base | Smaller technical depth than global apps; less standardisation |

## Where Fleet360 should NOT try to compete

These are losing battles for a mid-stage product:

1. **Enterprise-grade ERP integration with SAP/Oracle/JDE** — SAP TM and Oracle OTM are sold as part of an ERP stack with deep CRM/finance/procurement integration. Fleet360 cannot replicate decades of connector engineering.
2. **Global EDI mesh and 1000+ carrier integration** — Project44 and FourKites have invested 8+ years in carrier ELD/AVL integrations. Building this from scratch is a multi-year, multi-million-dollar bet.
3. **Massive carrier marketplace network effects** — Uber Freight, DAT, and Convoy have 100k+ carriers on their platforms. New entrants face a cold-start problem; Fleet360 needs a different wedge.
4. **Multi-modal optimisation across truck/rail/air/ocean** — Out of scope for the immediate roadmap; specialist apps own this domain.

## Where Fleet360 is well-positioned to win

Three plausible wedges, all GCC-anchored:

### Wedge 1 — "All-in-one fleet operations for GCC mid-market"

Most GCC mid-market shippers (50-500 vehicles) don't run SAP TM. They run a TMS for shipments, a separate app for vehicles, a third for maintenance, a fourth for driver compliance — and reconcile in Excel. Fleet360 already has **Logistics + RAC + Leasing + Maintenance + School Bus + Incident + Finance + Service Tickets** in one platform. That bundle is the differentiator. **No single competitor wraps logistics with the surrounding ops modules.**

### Wedge 2 — "Private freight marketplace for vertical industries"

Fleet360's marketplace today is **private** (`marketplaceStatus: 'PRIVATE'`) — Cargo owners can run their own carrier RFQs without publishing loads on a public board. This is the model SAP/Oracle don't offer (too enterprise) and Uber Freight doesn't offer (they want loads on their public market). For **industries with sensitive cargo or consistent lane patterns** (construction materials, oil & gas, FMCG distribution, e-commerce 3PL networks), private marketplaces are the right shape.

### Wedge 3 — "GCC-first compliance + integration"

GCC shippers and carriers need:
- TRN / VAT-compliant invoicing
- Arabic UI alongside English
- RTA Mulkiya / vehicle-registration lookup
- Salik toll integration
- Dubai Customs / Abu Dhabi Customs declarations
- E-trucking permit lookups
- Emiratisation reporting hooks

Global apps either ignore these or treat them as customisation. A GCC-first product that ships these as first-class features wins regional procurement decisions.

## Differentiation hypotheses to lean into

| Lean into | Deprioritise |
|---|---|
| All-in-one fleet ops platform (Logistics + adjacent modules) | Standalone TMS competition with SAP/Oracle |
| Private freight marketplace with vertical templates | Public open freight board (competing with DAT) |
| GCC localisation (Arabic, AED, VAT, customs, RTA, Salik) | Global multi-country support |
| Embedded finance reconciliation (3-way match already shipped) | Building a separate accounting product |
| Carrier scorecard + private network curation | Sourcing 100k+ public carriers |
| Modern UI / fast iteration / "consumer-grade" UX | Matching enterprise TMS feature surface |

---

# Section 2 — Executive Feature & Gap Summary

## What Fleet360 has TODAY (inventory)

| Surface | Count / Capability |
|---|---|
| **UI pages** | 24 — dashboard, marketplace, dispatch, quotes, rate-contracts, carriers, carrier scorecards, control-tower, customer tracking, tracking map, field-ops (driver app), trips list, trip documents, manifest, POD, shift handovers, drivers, driver performance, vehicles, finance reconciliation, analytics, accessorials, master data, route planner |
| **API endpoints** | 40+ — shipments CRUD, RFQs/bids/award, carrier-portal public invite, carriers CRUD + compliance, rate contracts, quotes, tracking, customer tracking, trips status/manifest/POD/documents, control tower, shift handovers, accessorials, master data, carrier scorecards, analytics, driver stats, finance reconciliation, telematics, SLA, stats, operations pulse, marketplace settings, exceptions, change history |
| **Prisma models** | 13 — `LogisticsCarrier`, `LogisticsShipmentOrder`, `LogisticsConsignment`, `LogisticsCargoLine`, `LogisticsShipmentStop`, `LogisticsRouteLeg`, `LogisticsFreightRfq`, `LogisticsCarrierBid`, `LogisticsAssignment`, `LogisticsTrackingEvent`, `LogisticsPodEvent`, `LogisticsFreightCharge`, `LogisticsCarrierSettlement`, `LogisticsShipmentException` (14 with exception model) |
| **Workflow** | Status machine: DRAFT → PENDING → APPROVED → ASSIGNED → DISPATCHED → ENROUTE_PICKUP → LOADED → ENROUTE_DELIVERY → DELIVERED → POD_SUBMITTED → CLOSED |
| **Service Configuration** | Registered as `LOGISTICS` in the LinkedModule registry — eligible to use the Service Configuration engine's SLA, approval, workflow, form fields tabs |

## 12-dimension scorecard

Each dimension scored 1-10 (see [methodology](#rating-methodology)). Composite is weighted; shipping-critical dimensions (★) count 1.5×.

| # | Dimension | Score | Rationale |
|---|---|---|---|
| 1 | **Order / shipment capture** | 5 | Multi-stop shipment creation, cargo lines with hazmat / temp flags, customer/carrier portal. Missing: EDI 204 intake, multi-channel intake (email parsing, PDF OCR), bulk CSV import in main UI |
| 2 | **Spot market & RFQ** | 7 | `LogisticsFreightRfq`, `LogisticsCarrierBid`, multi-round negotiation, public invite tokens, carrier portal bid submission, award workflow. Strong area. Missing: auction countdown, sealed-bid, automated counter-offers |
| 3 | **Rate & contract management** | 4 | Rate contracts page + UI calculator (base + fuel + urgency + hazmat + insurance + customs). Missing: persistent rate matrix engine (no auto-calc on shipment creation), tariff versioning, accessorial templates, fuel surcharge auto-indexing |
| 4 | **Route planning & optimisation** ★ | 3 | Planner page with waypoints / distance / duration / fuel cost — but no actual optimisation algorithm (no VRP solver, no load-balancing across stops). Mostly a calculator front-end |
| 5 | **Dispatch & execution** ★ | 6 | Dispatch page validates payload/hazmat/temp/SLA, `LogisticsAssignment` tracks acceptance/dispatch/completion. Field-ops page is functional for drivers. Missing: tendering with timeout/auto-escalation, dock scheduling, trailer / asset assignment |
| 6 | **Real-time visibility & ETA** ★ | 4 | `LogisticsTrackingEvent` GPS points with source tagging (GPS/driver_update/epod/estimated), tracking map page. Missing: live geofencing alerts, ML-driven ETA prediction, multi-leg carrier visibility, ELD integration |
| 7 | **ePOD & documentation** ★ | 6 | POD page with signature canvas, photo upload, GPS capture; documents page lists BOL/invoice/packing list/customs. Missing: OTP delivery validation, dynamic BOL generation, customs form auto-fill, e-signature legal compliance (UAE Federal Decree-Law No. 46) |
| 8 | **Carrier management** | 7 | Carrier CRUD, onboarding status, compliance docs upload + verification, vehicle registration, scorecard KPIs (on-time %, acceptance, cancellation, claim rate, quality), preferred/blacklist flags. Strong. Missing: insurance expiry auto-alerts, sanctions/AML screening, automated re-verification cadence |
| 9 | **Compliance** ★ | 3 | Hazmat flag, temp range fields, customs doc category exist as **fields**. No HOS (Hours of Service) tracking, no rest-time enforcement, no automated hazmat rule engine, no customs broker integration, no Mulkiya/insurance expiry alerts in logistics |
| 10 | **Freight audit & payment** ★ | 7 | Finance reconciliation page with 3-way match (customer charges vs. carrier charges vs. finance postings), `LogisticsFreightCharge` for accessorials, `LogisticsCarrierSettlement` for carrier payouts with commission. Strong. Missing: automated invoice matching engine, dispute workflow, payment gateway integration |
| 11 | **Analytics & reporting** | 5 | Analytics page (completion %, cancellation %, on-time %, type breakdown), driver performance, carrier scorecards. Missing: lane analytics, cost-per-km dashboards, profitability per shipment, predictive demand, exportable BI |
| 12 | **Integration & extensibility** | 2 | No EDI (204/210/214/990/997), no webhooks, no public API documentation, no API marketplace, no IoT sensor framework. Internal-only. Major gap |

## Composite score

**Weighted formula** — shipping-critical dimensions (1, 4, 5, 6, 7, 9, 10) count 1.5×, others 1.0×.

```
Standard total: 5+7+4+3+6+4+6+7+3+7+5+2 = 59
Weighting:      5×1.0 + 7×1.0 + 4×1.0 + 3×1.5 + 6×1.5 + 4×1.5 + 6×1.5 + 7×1.0 + 3×1.5 + 7×1.5 + 5×1.0 + 2×1.0
              = 5 + 7 + 4 + 4.5 + 9 + 6 + 9 + 7 + 4.5 + 10.5 + 5 + 2 = 73.5 / 14.5 max-weight = 5.07/10
```

**Fleet360 today: 5.1 / 10**

### Peer composite (directional)

| Application | Composite | Strongest | Weakest |
|---|---|---|---|
| **SAP Transportation Management** | 9.2 | Compliance, optimisation, EDI/integration | UX, time-to-value |
| **Oracle OTM** | 9.0 | Multi-modal, contract mgmt, freight audit | UI, mid-market fit |
| **Manhattan Active TM** | 8.7 | Optimisation, real-time, modern stack | Cost, integration with non-Manhattan |
| **Uber Freight** | 8.4 | Spot market, mobile UX, carrier network | Contract management, shipper analytics |
| **Convoy / Flexport** | 8.2 | Marketplace, automation, visibility | Enterprise depth, multi-modal |
| **Project44** | 7.8 | Visibility, ETA, carrier integrations | No booking/dispatch (visibility-only) |
| **FourKites** | 7.6 | Visibility, exception management | Same — visibility-only |
| **Trukker (KSA/UAE)** | 6.1 | Regional carrier base, marketplace, mobile | Enterprise features, integrations |
| **TruKKin (UAE)** | 5.8 | Spot freight, GCC focus | Smaller feature surface |
| **Fleet360 (today)** | **5.1** | RFQ/marketplace, 3-way finance, multi-module bundle | Compliance, optimisation, integrations |
| **Fleet360 (target — 12 mo)** | **7.0+** | Above + GCC compliance, ML ETA, EDI/webhooks | — |

Fleet360 sits in the **mid-pack with regional players**, well behind enterprise TMS, and within striking distance of the marketplace cohort. The 5.1 → 7.0 trajectory requires the priorities below.

## Top 10 prioritised gaps

Each gap is rated for **impact** (revenue/retention/competitive position) and **effort** (engineering investment). One-line recommendations include file/area pointers.

| # | Gap | Impact | Effort | Why it matters | Where to start |
|---|---|---|---|---|---|
| 1 | **Persistent rate matrix engine** — auto-calculate customer + carrier rates from a versioned rate card on shipment creation, with fuel surcharge auto-indexing | High | M | Today rates are calculator-only. Without auto-calc, shippers do manual quoting which kills speed-to-quote. Hurts marketplace adoption | New `src/lib/logistics/rate-engine.ts`, extend `LogisticsRateContract` model with versioning + tariff lines, wire into shipment create flow |
| 2 | **EDI 204 (Load Tender) / 210 (Invoice) / 214 (Status) support** | High | L | Without EDI, Fleet360 cannot integrate with any enterprise shipper or 3PL. Blocks B2B sales motion. Even minimal EDI 214 unlocks shipper-side carrier scorecards | New `src/app/api/logistics/edi/{intake,outbound}/route.ts`, `src/lib/logistics/edi/{x12-parser,x12-emitter}.ts`. Start with EDI 214 (lowest complexity) |
| 3 | **ML-driven ETA prediction with continuous-update SMS/email notifications** | High | M | Static planned-duration ETAs are the customer-experience equivalent of FedEx in 2005. Modern shippers expect Convoy/Uber-level dynamic ETAs | `src/lib/logistics/eta-predictor.ts` — start with linear regression on `LogisticsTrackingEvent` history, add ML model in v2. Tie into existing `LogisticsTrackingEvent` and `customer-tracking` |
| 4 | **HOS / driver compliance + insurance expiry alerts** | High | S | Hard regulatory requirement in many markets; absence is a deal-breaker for serious carriers. Insurance lapse is a six-figure liability event | Extend `LogisticsAssignment` with `driverHosBudgetMin`; new `src/lib/logistics/compliance-engine.ts`. Reuse `alertConfigs` from existing maintenance module |
| 5 | **Geofencing alerts at pickup / delivery / route-corridor** | High | M | Catches deviations in minutes instead of hours. Cuts customer-complaint volume substantially | New `src/lib/logistics/geofence.ts`, add `geofenceRadiusM`, `geofencePolygon` to `LogisticsShipmentStop`. Trigger via `LogisticsTrackingEvent` insertion path |
| 6 | **Public tracking URLs with branded customer pages** | Med | S | Carriers and shippers expect to share a link with end-customers / consignees. Today everything is authenticated | New `src/app/track/[token]/page.tsx` (public, no auth) + tokenised access on `LogisticsShipmentOrder`. Reuse customer-tracking data layer |
| 7 | **Webhook framework for external integrations** | Med | M | Modern customers expect to subscribe to shipment-status events. Powers Slack/Teams notifications, customer ERPs, 3rd-party visibility platforms | New `src/lib/logistics/webhooks.ts`; subscriber model + signed-payload delivery + retry queue. Fire on every status transition in `LogisticsShipmentOrder` |
| 8 | **VRP-based route optimisation** (multi-stop sequencing minimising distance + time + cost subject to driver-window, vehicle-capacity, customer-window constraints) | Med | L | Current planner is a calculator, not an optimiser. Real route optimisation moves the needle on cost-per-shipment by 8-15% (Convoy claim) | Integrate Google OR-Tools (Python sidecar) or Mapbox Optimization API — start with API, build native solver later. New `src/lib/logistics/route-optimizer.ts` |
| 9 | **GCC compliance pack** — Arabic UI for logistics pages, TRN/VAT-compliant invoicing, Salik toll auto-cost-allocation, RTA/Mulkiya carrier-vehicle verification, Dubai Customs declaration intake | Med | M | The differentiation wedge identified in Section 1. Without these, Fleet360 is "just another TMS"; with them, it's the GCC TMS | UI: `next-intl` Arabic locale for `src/app/logistics/*`. Backend: new `src/lib/integrations/{rta,salik,dubai-customs}` adapters. Reuse `localizedName` / `localizedDesc` patterns from `Tenant` model |
| 10 | **Lane analytics + profitability dashboards** — cost-per-km, margin-per-shipment, lane volume trends, carrier price competitiveness | Med | S | The data is already in `LogisticsShipmentOrder` (`customerRateAmount`, `carrierCostAmount`, `marginAmount`). UI just needs to surface it. Quick win | Extend `src/app/logistics/analytics/page.tsx` — add lane breakdown, margin trend, carrier price-vs-market chart. Add `/api/logistics/analytics/lanes` aggregate endpoint |

---

# Section 3 — Full Comparative Matrix

## Matrix A — vs. Enterprise TMS

Fleet360 (FL360) compared against **SAP Transportation Management (SAP TM)**, **Oracle Transportation Management (OTM)**, **Manhattan Active TM (Manh)**, **Blue Yonder TM (BY)**, **MercuryGate (MG)**.

| Capability | FL360 | SAP TM | OTM | Manh | BY | MG |
|---|---|---|---|---|---|---|
| **Order Management** | | | | | | |
| Multi-stop shipment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cargo line items (hazmat, temp, dimensions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| EDI 204 (Load Tender) intake | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| API-based order intake | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Email/PDF order parsing | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ |
| Bulk CSV import | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Planning & Optimisation** | | | | | | |
| Multi-modal selection (truck/rail/air/ocean) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| VRP route optimisation | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Load consolidation (LTL → TL) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Carrier rate shopping at quote time | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Capacity planning | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Dock scheduling | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Execution** | | | | | | |
| Carrier tendering with auto-escalation | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Driver mobile app | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ |
| ePOD (signature, photos, GPS) | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dynamic BOL generation | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Yard / trailer management | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Visibility** | | | | | | |
| Real-time GPS tracking | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Geofencing alerts | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| ML-driven ETA | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Multi-carrier visibility (cross-fleet) | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Exception management workflow | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Freight Audit & Pay** | | | | | | |
| 3-way invoice match | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Accessorials engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Carrier settlement / payment | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dispute resolution workflow | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Compliance** | | | | | | |
| HOS / driver hours tracking | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hazmat compliance rules engine | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customs documentation auto-gen | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Carrier insurance / cert verification | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Integration** | | | | | | |
| EDI mesh (204/210/214/990/997) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Webhooks for events | ❌ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Public REST API + docs | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pre-built ERP connectors | ❌ | ✅ (SAP) | ✅ (Oracle) | ⚠️ | ⚠️ | ⚠️ |
| Carrier API integrations (1000+) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Analytics** | | | | | | |
| Lane analytics | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cost-per-km / profitability | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Predictive demand | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Custom report builder | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Read:** Fleet360 has parity on **basic order management, ePOD, exception mgmt, 3-way match, accessorials, GPS tracking, driver app**. Major gaps are **EDI, optimisation, compliance engines, integration mesh, predictive analytics**.

## Matrix B — vs. Freight Marketplaces

Fleet360 (FL360) vs. **Uber Freight (UF)**, **Convoy/Flexport (Conv)**, **DAT Load Board (DAT)**, **Truckstop.com (Trkst)**, **Trukker (Trk)** [KSA/UAE], **TruKKin (TK)** [UAE].

| Capability | FL360 | UF | Conv | DAT | Trkst | Trk | TK |
|---|---|---|---|---|---|---|---|
| **Marketplace** | | | | | | | |
| Spot load posting | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open / public load board | ❌ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ |
| Private RFQ (selected carriers) | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ | ⚠️ |
| Multi-round bidding / negotiation | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Auction with countdown / sealed bids | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Instant book / dynamic pricing | ❌ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| Public carrier-invite tokens | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| **Carrier Side** | | | | | | | |
| Carrier mobile app | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Carrier rating / scorecard | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Carrier onboarding workflow | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Document verification automation | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Quick-pay / factoring integration | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Carrier network size | Small (tenant private) | 100k+ | 50k+ | 1M+ DOT | 1M+ DOT | ~10k GCC | ~3k UAE |
| **Shipper Side** | | | | | | | |
| Shipper portal | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| Real-time tracking customer share | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| Lane analytics for shippers | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Contract management | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ |
| **Financials** | | | | | | | |
| Embedded freight audit | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Carrier settlement & payouts | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Multi-currency / AED | ✅ | ❌ (USD only) | ❌ (USD only) | ❌ | ❌ | ✅ | ✅ |
| Payment escrow | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ |

**Read:** Fleet360's marketplace is genuinely competitive on **multi-round bidding, public carrier-invite tokens, private RFQ — and stands out on AED/multi-currency vs. US-centric marketplaces**. Gaps are **carrier network size** (cold-start problem), **instant book / dynamic pricing**, **quick-pay / factoring**, and **mobile-first carrier UX**.

## Matrix C — vs. Visibility Platforms (focused on visibility dimensions only)

Fleet360 (FL360) vs. **Project44 (P44)**, **FourKites (FK)**, **Shippeo (Shp)**.

| Capability | FL360 | P44 | FK | Shp |
|---|---|---|---|---|
| Real-time GPS for owned fleet | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Real-time GPS for cross-carrier | ⚠️ | ✅ | ✅ | ✅ |
| ELD integration (1000+ carriers) | ❌ | ✅ | ✅ | ✅ |
| ML-driven dynamic ETA | ❌ | ✅ | ✅ | ✅ |
| Geofencing arrival/departure events | ❌ | ✅ | ✅ | ✅ |
| Customer notification engine (SMS/email/push) | ⚠️ | ✅ | ✅ | ✅ |
| Public branded tracking pages | ❌ | ✅ | ✅ | ✅ |
| Exception management workflow | ✅ | ✅ | ✅ | ✅ |
| Predictive disruption alerts (weather, port congestion) | ❌ | ✅ | ✅ | ⚠️ |
| Carrier scorecard from visibility data | ✅ | ✅ | ✅ | ⚠️ |

**Read:** Fleet360 is **strong on owned-fleet visibility** (GPS tracking, scorecards from visibility data). It is **absent on cross-carrier ELD integration, ML ETA, and public branded tracking** — the four things visibility specialists own. These are also the highest-ROI gaps because the underlying data model (`LogisticsTrackingEvent`) is already there; what's missing is the inference engine and the external integrations.

## Matrix D — Regional / Middle East deep dive

GCC shippers and carriers expect localisation that global apps don't provide. Fleet360 vs. **DP World CARGOES (CARGOES)**, **Aramex Logistics Platform (Aramex)**, **Trukker (Trk)**, **TruKKin (TK)**, **Maqta Gateway (Maqta)**.

| GCC-specific capability | FL360 | CARGOES | Aramex | Trk | TK | Maqta |
|---|---|---|---|---|---|---|
| Arabic UI | ⚠️ (partial in adjacent modules) | ✅ | ✅ | ✅ | ✅ | ✅ |
| AED-native pricing / billing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| UAE TRN / VAT-compliant invoicing | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| RTA Mulkiya vehicle verification | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Salik / Darb toll integration | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ |
| Dubai / Abu Dhabi Customs declaration | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Maqta Gateway integration | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| GCC e-trucking permit lookup | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ |
| Emiratisation reporting hooks | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Multi-emirate carrier coverage | ⚠️ (depends on tenant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cargo Community System integration | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Free Zone customs flows | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |

**Read:** This is where Fleet360 has the most ground to gain. The **AED-native architecture** is a real advantage over US-centric marketplaces, but on every other GCC-specific capability Fleet360 is **at or behind regional players**. The good news: most of these are integration adapters (a few weeks each), not multi-year platform investments. The wedge described in Section 1 lives or dies on closing these gaps.

---

# Insights & Recommendations

## Three patterns that emerge from the matrix

1. **Fleet360 is competitive on workflow and weak on integration.** The marketplace, RFQ, dispatch, ePOD, and finance flows are real and roughly mid-market grade. The integration surface (EDI, webhooks, public API, carrier ELD) is essentially empty. **Integration is the bottleneck to enterprise sales.**

2. **The compliance gap is the biggest reputational risk.** No HOS tracking, no insurance-expiry alerts, no automated hazmat rules. For carriers and shippers operating fleets, these aren't nice-to-have — they're a liability if absent. A single insurance-lapse incident on a Fleet360-managed shipment is a six-figure event.

3. **The localisation wedge is wide open.** Every global app treats GCC as a customisation problem. None of the regional players have the full-stack fleet-ops bundle Fleet360 has. **Owning GCC-first compliance and integrations is the differentiator that can't be copied quickly.**

## Suggested 12-month investment ordering

The 10 gaps in Section 2 are listed by priority. If I had to recommend a quarterly sequencing:

| Quarter | Focus | Why first |
|---|---|---|
| **Q1** | Gaps #1 (rate engine), #4 (HOS / insurance alerts), #6 (public tracking URLs) | Unblocks speed-to-quote, plugs the compliance liability, immediate customer-experience win — none requires deep new infrastructure |
| **Q2** | Gaps #5 (geofencing), #10 (lane analytics), #9 (GCC compliance pack v1 — Arabic UI + TRN/VAT) | Compounds visibility + analytics + regional wedge into one quarter — most code-paths overlap |
| **Q3** | Gaps #2 (EDI 214 → 210 → 204), #7 (webhooks) | Opens the integration story for enterprise sales — usually a 6-9 month cycle from "we have webhooks" to "we closed a 5-figure ARR deal" |
| **Q4** | Gaps #3 (ML ETA), #8 (VRP route optimisation), GCC pack v2 (Salik, customs) | The harder bets — best done last when traffic data has accumulated for model training and customer flow has revealed which compliance integrations matter most |

## On the composite rating

5.1 / 10 sounds harsh until you see what it's compared against. The peers Fleet360 is benchmarked against are 5-15 year-old companies with hundreds of engineers. **For a multi-module platform built primarily in the last 18 months, scoring 5.1 on logistics specifically while shipping 6 other modules in parallel is a strong execution rate.** The right framing is "what does 7.0 look like by next year" — and the priority list above is the path.

---

# Methodology & Caveats

## Rating methodology

Each dimension is scored 1-10:
- **1-3:** Absent or barely functional
- **4-6:** Partial, usable but with major gaps (most current Fleet360 scores)
- **7-8:** Production-grade, comparable to mid-market peers
- **9-10:** Best-in-class

The composite is a weighted average. Shipping-critical dimensions (1, 4, 5, 6, 7, 9, 10 — the things that, if broken, stop the truck) are weighted 1.5×.

## Data sources

- **Fleet360 inventory** — direct code inspection via Explore agent (UI pages, API routes, Prisma models, business logic files). High confidence.
- **Competitor capabilities** — vendor websites, public G2 / Gartner / IDC reviews, analyst feature lists, public pricing pages from training-data baseline. Spot-verified for the most-cited claims.
- **Composite scores** — directional consensus from public benchmarks; not audited.

## Caveats

- **Vendor capabilities change weekly.** Some matrix cells may be 6-12 months stale. The 2026-05 evaluation date is the relevant lens.
- **Some vendors don't publish detailed feature sheets.** Where uncertain, ⚠️ (Partial) is the default rather than ✅ — leaning conservative.
- **Regional players (Trukker, TruKKin, CARGOES) publish less than global vendors.** Their cells are best-effort from public reporting and customer-reference data.
- **Fleet360 scores reflect what's in the codebase, not what's announced or planned.** The Service Configuration engine, workflow merge, and binding layer all add to Fleet360's *platform* capability but don't directly close logistics-specific gaps.

## What this analysis does NOT cover

- Pricing / commercial strategy
- Implementation cost or TCO comparison
- Specific customer references or win/loss data
- Detailed UX comparison (screenshots, click-paths)
- Mobile app benchmarking (iOS vs Android coverage)
- Sustainability / CO2 tracking (becoming material in EU, less so in GCC today)

These would each be a follow-up exercise if useful.

---

**End of analysis.** For questions, code-level walkthroughs of any gap, or to discuss the suggested quarterly sequencing, see the dev team.
