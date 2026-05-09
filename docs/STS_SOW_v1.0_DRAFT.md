# Statement of Work — STS Vehicle Leasing Platform v1.0

**DRAFT — Internal working document. Not yet circulated to STS.**

| Field | Value |
|---|---|
| **Customer** | STS [STS TO CONFIRM full legal name] |
| **Vendor** | XL AI / EXL Solutions [TO CONFIRM signing entity] |
| **Project** | Vehicle Leasing Platform — STS deployment |
| **Fleet size** | 200 vehicles (initial) |
| **Customer model** | B2B (corporate fleet) + B2C (individual lessees) |
| **Languages** | English + Arabic (bilingual) |
| **Currency** | AED (UAE Dirham) |
| **Soft go-live** | 31 July 2026 [STS TO CONFIRM date is acceptable as soft, not hard] |
| **Production hardening window** | Aug 2026 (4 weeks of stabilisation post-go-live) |
| **Contract value** | [STS TO CONFIRM — implementation fee + monthly SaaS] |
| **Payment milestones** | [STS TO CONFIRM] |
| **Document version** | v1.0 DRAFT, dated 2026-05-05 |

## 1. Project description

XL AI Smart Mobility Platform — **Vehicle Leasing module** — deployed for
STS to manage their 200-vehicle leased fleet across both corporate (B2B)
and individual (B2C) customers. The platform is built on a modern Next.js
stack with PostgreSQL persistence, multi-tenant architecture (STS is the
sole production tenant in v1.0), and bilingual (EN/AR) UI.

The defining differentiator from competitor systems (LeaseProXL, etc.) is
the **AI Co-pilot suite**: three OpenAI-powered features that automate
high-value workflows.

## 2. v1.0 Inclusions

### 2.1 Foundation
| Item | Description |
|---|---|
| Multi-tenant platform | Session auth, tenant context, rate limiting, role-based access. STS deployed as the sole tenant. |
| Bilingual UI (EN/AR) | All user-facing strings translated; RTL layout when Arabic selected. |
| Audit log | All financial mutations (contract create/terminate, invoice issue, payment receipt, lessee onboard) recorded with user/tenant/entity attribution. |
| Error tracking (Sentry) | All unhandled exceptions and request errors captured with stack traces. |
| Daily DB backups | Via Neon Pro plan PITR (7-day point-in-time recovery). |
| CI/CD | GitHub Actions running lint + typecheck + unit tests + build on every PR. |
| Production deployment | [STS TO CONFIRM target — Vercel / AWS / on-premise UAE host] |

### 2.2 Operational features (LeaseProXL-equivalent core)
| # | Feature | Notes |
|---|---|---|
| 1 | **Lessee management — B2B + B2C** | Corporate KYC requires trade license. Individual KYC requires Emirates ID + nationality. Discriminated Zod schema validation. |
| 2 | **Quotation builder** | Multi-line, multi-vehicle, VAT-aware, status workflow (NEW → SENT → APPROVED). Bilingual PDF generation. |
| 3 | **Contract management** | Master + individual contracts. Status lifecycle (DRAFT → ACTIVE → TERMINATED → CLOSED). Auto-generated payment schedule. Bilingual contract PDF. |
| 4 | **Invoice + receipt + statement** | INV-NNNNNN auto-numbering, FTA-compliant VAT 5% with TRN, bilingual PDF (EN+AR), company letterhead. |
| 5 | **Mileage overage engine** | Reading capture (delivery/monthly/return) → cap comparison → auto-overage row → auto-invoice generation. Rate sourced from contract. |
| 6 | **Pre-billing statements** | Aggregates base rent + fuel + fines + maintenance + overage per period. PBS-NNNNN numbering. Customer review window before billing. |
| 7 | **Documents + expiry alerts** | File upload (Mulkiya, insurance certs, EID, trade license, signed agreements). Expiry alert batch job (30 / 14 / 1 days before). |
| 8 | **Dunning workflow** | 30 / 60 / 90-day overdue reminders. Bilingual email templates. Automated nightly batch. |
| 9 | **Customer self-service portal — read-only v1** | B2B fleet manager view (multi-vehicle dashboard, invoices, statements). B2C "my vehicle" view (single contract, own invoices, payments, documents). |
| 10 | **Receipts & payments** | Cash / cheque / bank transfer / card. Cheque number + bank reference. Auto-allocation against open invoices. |
| 11 | **Vehicle handover & return** | Pre/post inspection capture, mileage reading, condition notes. |
| 12 | **Vehicle exchange & transfer** | Mid-contract vehicle swap, branch-to-branch transfer. |
| 13 | **Approvals workflow** | Multi-step approval configuration for quotations and contracts. Role-based, sequential, with audit trail. |
| 14 | **Expiry alerts dashboard** | Contract, insurance, registration, license expiry tracking. |
| 15 | **Branches** | Multi-branch operation with branch-aware data scoping. |

### 2.3 STS Value-add: AI Co-pilot (the contracted differentiator)
| # | Feature | Description |
|---|---|---|
| AI-1 | **AI Quotation Co-pilot** | Natural-language brief in EN or AR ("3 SUVs, 24 months, 30k km/year, low credit risk corporate") → generates structured multi-line quotation with pricing rationale. Built on existing OpenAI agent infrastructure. |
| AI-2 | **AI Document Auto-Classification** | Drop a trade license / EID / Mulkiya / insurance certificate PDF or photo → GPT-4o vision extracts fields (number, expiry, holder name in EN+AR), files under correct entity, sets renewal alert. |
| AI-3 | **AI Contract Q&A** | Staff or lessees ask questions in natural language ("when is my next payment due?", "how many km left on my cap?") → tool-calling agent queries contract data and answers in the user's language. |

### 2.4 ERP integration (export-only in v1.0)
| Format | Use |
|---|---|
| Zoho Books CSV | Invoices, lessees (as Contacts), payments — manual import on STS finance side. |
| Tally Excel | Vouchers and ledger entries — manual import on STS finance side. |
| **Direct API integration** (Zoho REST / Tally HTTP) | **DEFERRED to v1.1** — see Section 4. |

### 2.5 Data migration (initial onboarding)
- Bulk CSV import tools for: vehicles (200), lessees, existing contracts,
  payment history.
- Dry-run preview before commit. Error report for invalid rows.
- One-time migration support during go-live week.

## 3. Acceptance criteria

For each v1.0 feature above, acceptance is defined as:
1. The happy path works end-to-end in production with realistic STS data.
2. The relevant Playwright E2E test passes.
3. The audit log captures the action with full attribution.
4. Bilingual UI renders correctly in both EN and AR.
5. STS operations team can complete the workflow without engineer assistance.

A formal UAT round will be scheduled in the final 2 weeks before go-live.

## 4. v1.0 Exclusions — Deferred to v1.1+

The following items are **explicitly out of scope** for v1.0 and will be
addressed in v1.1+ post-July 2026 go-live. STS acknowledges these are not
part of the v1.0 deliverable. [STS TO CONFIRM acknowledgement]

| Deferred item | Target |
|---|---|
| Vehicle Procurement / Purchase Order module | v1.2 (Q4 2026) |
| Vehicle Remarketing & Residual Value engine | v1.2 (Q4 2026) |
| Direct API integration with Zoho Books and Tally | v1.1 (Q3 2026) |
| Customer portal write actions (request changes, raise tickets) | v1.1 |
| Native mobile app (iOS + Android) for field operations | v2.0 (2027) |
| Telematics / GPS integration for auto-mileage capture | v1.2 (Q4 2026) |
| Direct debit (UAEDDS bank integration) | v1.1 (subject to bank onboarding) |
| AECB credit bureau integration | v1.2 (subject to AECB licence) |
| Salik / RTA / Mulkiya direct feeds | v1.2 (subject to API access) |
| UAE PASS e-signature | v1.1 |
| Consolidated invoicing across multiple contracts | v1.1 |
| Aging analysis with full customer statement PDFs | v1.1 |
| Advanced BI / drill-down analytics dashboards | v1.2 |
| Field-level RBAC (finance vs ops viewing rates) | v1.1 |
| Full multi-tenant data scoping at query level | v1.1 (STS is single-tenant in v1.0) |

## 5. Timeline

| Week | Phase | Major deliverables |
|---|---|---|
| 1 (May 5–11) | Phase 0 Foundation | CI, env validation, Sentry, audit log scaffold, branch strategy, SoW signed |
| 2 (May 12–18) | Phase 0 / Bilingual setup | RTL/AR coverage on leasing pages, Noto Sans Arabic font integration |
| 3–4 (May 19–Jun 1) | Phase 1a — PDF Engine | Bilingual PDF templates for quotation, contract, invoice, receipt, statement |
| 5 (Jun 2–8) | Phase 1b — Bulk import + Phase 1c — Mileage engine | CSV import for 200 vehicles + lessees; mileage overage rate-from-contract + auto-invoice |
| 6 (Jun 9–15) | Phase 1d — Documents + Phase 1e — Pre-billing | File upload, expiry alerts, pre-billing aggregation, bilingual PDF |
| 7 (Jun 16–22) | Phase 1f — Dunning + Phase 1g — B2B/B2C polish | 30/60/90 reminder batch, bilingual email templates, KYC flows |
| 8 (Jun 23–29) | Phase 1h — Customer portal | Read-only B2B + B2C portal pages |
| 9 (Jun 30–Jul 6) | Phase 1i,j — AI features | Quotation Co-pilot + Document Auto-Classification |
| 10 (Jul 7–13) | Phase 1k — AI Contract Q&A + Phase 1l — ERP CSV | Contract Q&A agent + Zoho/Tally CSV exports |
| 11 (Jul 14–20) | UAT round 1 | STS team uses production with real data; bug fixes |
| 12 (Jul 21–27) | UAT round 2 + Deployment | Final fixes, production deployment, runbook handoff |
| **31 Jul 2026** | **Soft go-live** | First STS users on production |
| Aug 1–28 (4 wk) | Stabilisation | Hot-fixes, monitoring, support handoff |

[STS TO CONFIRM — milestone payment triggers if any align with these dates]

## 6. Assumptions and dependencies

The following must hold for the timeline above to be deliverable:

1. **STS provides a designated point-of-contact** within their operations team
   for daily UAT feedback during weeks 11–12.
2. **Production hosting decision is made by end of week 1**
   (Vercel / AWS / on-premise) so deployment automation can be set up.
3. **STS data migration files** (vehicles, lessees, contracts) are provided
   in CSV/Excel format by **end of week 4** for the bulk import to be tested.
4. **A Neon Postgres Pro plan** is provisioned (for PITR backups) before
   production cutover. Cost is bundled into the platform fee.
5. **OpenAI API key** with at least the GPT-4o family enabled is provisioned
   before week 9. Estimated AI usage cost: ~AED 500–1,500/month at 200-vehicle
   scale; passed through at cost.
6. **STS is single-tenant** in v1.0. Onboarding a sub-tenant or second
   customer triggers v1.1 multi-tenant scoping work.
7. **Solo developer** — XL AI assigns one engineer to this project full-time.
   Capacity loss (illness, leave) of >5 working days will be communicated
   immediately and may require milestone re-baselining.

## 7. Change request process

Any v1.0 scope addition requested after this SoW is signed:
1. Submitted by STS in writing (email or ticket).
2. XL AI returns an impact assessment within 3 working days: effort
   estimate + impact on timeline + cost.
3. STS approves or declines in writing before work begins.
4. Default for unapproved requests: parked for v1.1.

The intent is to protect the July go-live date. Without this discipline,
scope creep will push the date by weeks.

## 8. Pricing and payment terms

[STS TO CONFIRM — fill in once commercial terms are agreed]

- Implementation fee: AED [______]
- Monthly SaaS fee: AED [______] / month for 200 vehicles
- Per-vehicle scaling: AED [______] / additional vehicle / month
- Payment milestones:
  - [ ] AED [____] on SoW signature
  - [ ] AED [____] on Phase 0 completion (week 1)
  - [ ] AED [____] on PDF + bilingual UI completion (week 5)
  - [ ] AED [____] on AI features completion (week 9)
  - [ ] AED [____] on go-live (31 Jul 2026)
  - [ ] AED [____] on stabilisation completion (28 Aug 2026)
- AI usage costs (OpenAI): pass-through at cost
- Hosting costs (Neon, Vercel/AWS): pass-through at cost OR bundled
  [STS TO CONFIRM preference]

## 9. Acceptance and signatures

[STS TO CONFIRM signatories]

| Role | Name | Signature | Date |
|---|---|---|---|
| For STS | | | |
| For XL AI / EXL Solutions | | | |

---

## Internal notes (STRIP before sending to STS)

**Open questions to resolve in week 1:**
1. STS legal entity name + signatory
2. Vendor signing entity (XL AI vs EXL Solutions)
3. Hard vs soft go-live date
4. Production hosting target
5. Commercial terms (implementation fee, monthly SaaS, scaling)
6. Whether STS has been promised "full LeaseProXL parity" anywhere in
   prior conversations — if yes, see Internal Note 2.

**Internal note 2 (parity tension):**
Earlier conversation indicated STS may expect "full LeaseProXL parity."
This SoW does NOT commit to that — it commits to a strong operational
core PLUS the AI Co-pilot differentiator, with v1.1+ roadmap closing the
parity gap over Q3–Q4 2026. If STS has documented parity expectations,
this SoW must be reviewed line-by-line with them before signing. The
fallback option is to extend the timeline (Sep 2026 instead of Jul) to
fit more parity items into v1.0, but that requires STS agreement first.

**Internal note 3 (capacity):**
Phase 1 effort estimate is ~85 dev-days. Solo runway through July is
~48 dev-days. The plan above assumes aggressive trimming. If any
v1.0 line item slips by more than 1 sprint, the schedule must be
re-baselined or the date pushed.
