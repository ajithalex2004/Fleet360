# Rent-A-Car Module — v1.0 Roadmap

**Status:** Draft · 2026-05-05 · Branch `feat/leasing-sts` (or fork to `feat/rac-v1` once a customer is signed)

## Strategic frame

Don't compete with CarPro RentSmart on parity — they have 25 years of accumulated features. **Compete on three things they cannot copy quickly:**
1. **AI-native customer-facing features** (quote co-pilot, damage AI, dynamic pricing)
2. **Cross-module data synergy** (RAC ↔ Leasing ↔ Maintenance on one data model)
3. **GCC-deep integrations** (Salik, Hala by Careem, WPS, AECB, RTA Mulkiya)

## What's already in place (leverage from Leasing v1.0)

These ship to RAC for free — no rebuild:
- ✅ Bilingual EN/AR PDF engine + Noto fonts + i18n dictionary
- ✅ Multi-tenant middleware + session + rate limiting
- ✅ Audit log helper (`logAudit` + `withAudit` wrapper)
- ✅ Sentry error tracking
- ✅ Validated env (`src/lib/env.ts`)
- ✅ CSV bulk-import library (vehicles, customers)
- ✅ AI agent infrastructure (`src/lib/agents/openai-client.ts`, structured outputs, tool-calling)
- ✅ File storage adapter (`src/lib/storage/index.ts`)
- ✅ Customer portal scaffold (`/portal/[tenantSlug]/`)

## Existing RAC code (audited 2026-05-05)

**Schema:** 12+ models — `RentalBooking`, `RentalAgreement`, `DamageClaim`, `RentalRateQuote`, `PricingRule`, `VehicleInspection`, `RentalCustomer`, `RentalInvoice`/`Line`/`Payment`, `RentalAdditionalCharge`, `RentalExtension`, `RentalVehicleExchange`. Strong foundation.

**Frontend:** 23 pages under `/rental/*` — Dashboard, Inquiries, Quotations, Bookings, Availability, Agreements, Renewals, Handover, Damage Claims, Transfers, Invoices, Pricing, Rate Engine, Customers, Documents, Insurance, Branches, Alerts, Staff.

**API:** 38 routes under `/api/rental/*` — bookings full lifecycle (confirm/activate/complete/cancel/extend), inspections, damage claims, agreements, invoices with payments, rates with calculate, etc.

**Honest depth:** Like Leasing pre-Phase-1 — solid schema, thin business logic. `bookings/route.ts` is 37 lines (CRUD shell), `damage-claims/route.ts` is 37 lines, `inspections/route.ts` is 27 lines. Real engines need to be built.

## v1.0 Roadmap (12-week solo)

| # | Item | Effort | Reuses from Leasing |
|---|---|---|---|
| **R1** | **AI Rental Quote Co-pilot** | 4d | `agents/quotation-copilot/` pattern, OpenAI structured outputs |
| **R2** | **Bilingual rental PDFs** — Agreement, Invoice, Receipt | 3d | PDF engine, fonts, i18n, theme |
| **R3** | **Add-on / ancillary catalogue** — GPS, child seat, additional driver, cross-border permit, Salik tag, fuel options | 5d | (new) |
| **R4** | **Yield-managed pricing engine** — LoR ladder + utilization-based + holiday calendar + channel tier | 8d | extends existing `lib/rental-rate-engine.ts` |
| **R5** | **AI damage classifier** — before/after photo diff, repair cost estimate from UAE bodyshop index | 4d | `agents/doc-classifier/` pattern, gpt-4o vision |
| **R6** | **Counter mobile PWA** — handover photos, walkaround damage app, EID/licence scan, e-sign, card pre-auth | 12d | (new) — biggest item |
| **R7** | **Channel manager skeleton + Hala by Careem** — push availability, pull bookings, rate parity | 10d | (new) |
| **R8** | **RevPAC + utilization analytics** — RAC's #1 KPI dashboard | 4d | (new) |
| **R9** | **WhatsApp booking confirmations** | 2d | Twilio already in stack |
| **R10** | **Cross-border permit auto-PDF** | 3d | PDF engine |
| **R11** | **Booking state machine + no-show / late-return penalties** | 3d | (new) |
| **R12** | **Customer portal RAC pages** (read-only B2C) | 4d | portal scaffold + leasing portal pattern |

**Total: ~62 dev-days** = 12 weeks solo at sustainable pace. Same rough envelope as Leasing v1.0.

## Recommended ship order

### Week 1 — AI demos (ports cleanly)
- R1 AI Co-pilot (4d)
- R2 Bilingual PDFs (3d, parallel)

These two together are the **demo-winning bundle** for the first sales call to a UAE rental operator. Type a brief in Arabic → get a structured booking with priced ancillaries → click PDF → bilingual rental agreement out the other side. No competitor in the GCC has this.

### Week 2-3 — Revenue engine
- R3 Add-ons catalogue (5d)
- R4 Yield-managed pricing engine (8d — week 2-3)

This is the actual revenue lever. Most small operators leave 10-15% on the table because they price flat.

### Week 4 — Damage AI
- R5 AI damage classifier (4d)

Closes the #1 customer-dispute area in RAC. Demoable with any bodywork photo.

### Week 5-7 — Counter PWA
- R6 Mobile counter app (12d — biggest single item)

This is the operational differentiator. CarPro RentSmart is desktop-bound. A counter PWA that does the full handover in 4 minutes vs the industry 15 wins enterprise demos.

### Week 8-9 — Channel manager
- R7 Channel manager + Hala by Careem (10d)

OTA integration is commodity at the global level (CarPro RentSmart has it for international OTAs). Hala by Careem is the **uniquely UAE play** — no competitor I'm aware of has it.

### Week 10 — Analytics + ops automation
- R8 RevPAC + utilization (4d)
- R9 WhatsApp confirmations (2d)
- R10 Cross-border permit PDF (3d)

### Week 11 — Operational closure
- R11 Booking state machine + penalty engine (3d)
- R12 Customer portal pages (4d)

### Week 12 — UAT + deployment

## Differentiators baked in

The roadmap above intentionally trades parity-features (which CarPro has) for moat-features (which they don't):

| Trade-off | What we're skipping | What we're shipping instead |
|---|---|---|
| **GDS integration** (Amadeus/Sabre) | Not in v1.0 — corporate travel agencies less critical for UAE leisure operators | Hala by Careem (a single OTA with dominant local share) |
| **Hertz-style global loyalty** | Defer to v1.1 | AI quote co-pilot (more impactful demo) |
| **Sub-second availability resolution at OTA scale** | Defer — STS-style direct ops, not Hertz-scale OTA | Real-time fleet utilization for the operator's own dashboard |
| **Native mobile app** | Defer — PWA covers 90% of the case | Counter staff mobile PWA (different use case, more leveraged) |

## Cross-module synergy plays (the true moat)

These aren't standalone features — they're integrations that only this platform can offer:

1. **Rent-to-Lease pipeline** — a customer renting monthly for 6+ months gets an auto-generated lease quotation. Internal handoff, no re-keying. Industry typically loses these to a separate leasing competitor.
2. **Shared fleet pool** — vehicles flow between RAC and Leasing inventories based on demand. CarPro physically can't do this; their products are separate.
3. **Maintenance-aware availability** — a vehicle's predictive-maintenance score (from existing predictive-maintenance agent) flows into RAC availability. Cars likely to break down get pulled from rental inventory automatically.
4. **Damage continuity across modules** — damage history follows a vehicle when it converts from rental to lease. Lessor sees full provenance.

Build these as v1.1 quick-wins after the v1.0 foundation lands.

## Customer questions before scoping the contract

[CUSTOMER TO CONFIRM] for any UAE RAC operator we sign:

1. Fleet size and category mix (economy/SUV/luxury split)
2. Number of branches and emirates
3. Channel mix today: % direct vs OTA vs corporate
4. Existing rate structure (flat? LoR? seasonal?)
5. Insurance arrangement: in-house or third-party (Oman, RSA, Salama)?
6. Counter staff count + tablet/phone availability for the PWA rollout
7. Hala by Careem partnership status (already onboarded? planned?)
8. Salik account for fleet (auto-recharge, weekly settlement?)

## Cron / scheduled jobs needed

Add to Vercel / external scheduler:
- Daily: utilization recalculation + RevPAC dashboard refresh
- Hourly: yield-engine price recalculation
- Daily: no-show / late-return detection sweep
- Daily: expiry alert sweep (insurance, registration — already exists for leasing, just include rental fleet)
- Weekly: rate parity check across channels (once channel manager is in)
