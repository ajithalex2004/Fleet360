# Fleet360

Fleet360 is a multi-tenant smart mobility platform for fleet operators. It combines fleet operations, vehicle leasing, rent-a-car, finance, maintenance, school bus, logistics, incidents, service tickets, admin configuration, and AI-assisted workflows in one Next.js application.

The current application is built for UAE fleet and mobility operations, with tenant-aware access, role-based admin tools, billing limits, service configuration, PDF generation, and operational agents.

## What Is In The App

- Platform shell: tenant-aware navigation, branding, language context, module guards, trial-plan limits.
- Fleet: vehicles, lifecycle, transfers, documents, fuel, HOS, insurance, fines, TCO, work orders.
- Leasing: inquiries, quotations, contracts, drivers, invoices, receipts, documents, renewals, mileage, fuel, fines, insurance, field workflows, analytics.
- Rental/RAC: availability, bookings, counter flow, handover, agreements, quotations, rates, pricing, ancillaries, channels, analytics.
- Finance: invoices, payments, deposits, GL, AR aging, VAT, budgets, bank reconciliation, fixed assets, management accounts.
- Maintenance: service requests, work orders, schedules, garages, quotations, predictive maintenance, job closure, data masters.
- School bus and bus ops: routes, stops, schedules, trips, attendance, parent and driver portals, live map, pre-trip checks, reports.
- Logistics, dispatch, incidents, compliance, sustainability, reports, approvals, and agents.
- Admin hub: tenants, roles, users, billing, audit logs, branding, SSO, API keys, service configuration, workflows, notification settings.

## Tech Stack

- Next.js 15 App Router, React 19, TypeScript 5
- Prisma 5 with PostgreSQL/Neon
- Tailwind CSS 4
- Vitest for unit/integration tests
- Playwright for E2E tests
- React PDF for generated documents
- OpenAI and Thesys/C1 integrations for assistant and GenUI features
- Optional Go backend utilities under `backend/`

## Repository Map

```text
src/app/                 Next.js pages and API routes
src/components/          Shared UI and domain components
src/contexts/            Tenant, branch, language, permission, toast contexts
src/lib/                 Domain logic, auth/session, Prisma, billing, PDF, agents
src/services/            Workflow, email, mock-data and integration helpers
src/types/               Shared TypeScript contracts
prisma/                  Prisma schema, migrations, seed scripts
tests/unit/              Vitest unit tests
tests/integration/       API and tenant/RBAC integration tests
tests/e2e/               Playwright workflows
docs/                    Runbook, known gaps, roadmaps and SOW notes
backend/                 Go helpers and legacy/backend experiments
public/                  Static assets, fonts, uploads in local development
```

## Getting Started

Requirements:

- Node.js 20.9 or newer
- npm
- PostgreSQL database, usually Neon or local Postgres

Setup:

```bash
npm install
cp .env.example .env
npx prisma generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For a fresh database, apply migrations with care:

```bash
npx prisma migrate dev
```

Do not run development migrations against production. See [docs/RUNBOOK.md](docs/RUNBOOK.md) for production database guidance.

## Useful Commands

```bash
npm run dev             # local Next.js dev server
npm run build           # production build
npm run typecheck       # TypeScript check
npm test                # Vitest suite
npm run test:unit       # unit tests only
npm run test:integration
npm run test:e2e        # Playwright E2E tests
npm run setup-hooks     # enable repo git hooks
```

## Environment

Start from `.env.example`. Important variables include:

- `DATABASE_URL`: PostgreSQL/Neon connection string
- `SESSION_SECRET`: required for signed session cookies
- `NEXT_PUBLIC_APP_URL`: app base URL
- `OPENAI_API_KEY`: AI/agent features
- `THESYS_API_KEY`: C1/GenUI chat features
- SMTP or provider-specific email settings
- Sentry DSNs for error capture

Never commit `.env` files. Rotate any credential that has been shared beyond the intended environment.

## Auth And Tenant Model

Fleet360 uses an `xl-session` HTTP-only cookie signed in `src/lib/tenant-session.ts`. Middleware verifies the cookie, injects `x-tenant-id`, `x-user-id`, `x-tenant-plan`, and `x-user-role`, then API routes use those headers for tenant scoping and authorization.

Routes that mutate tenant data should:

- Read tenant/user identity from middleware headers, not request bodies.
- Enforce role checks for admin actions.
- Filter reads and writes by tenant wherever the backing table has tenant ownership.
- Use `assertCanWrite()` for trial-plan write restrictions.

## Testing And Current Quality Notes

The app has a meaningful test structure, but the current codebase still has known TypeScript debt from schema evolution and older feature slices. See [docs/KNOWN_GAPS.md](docs/KNOWN_GAPS.md), especially `KNOWN-TS-001`.

Before merging high-risk work:

```bash
npm run typecheck
npm test
```

For UI-heavy changes, run the relevant Playwright workflow under `tests/e2e/`.

## Storage

The current storage adapter writes local uploads under `public/uploads`. That works for local development and persistent self-hosted deployments. It is not suitable for ephemeral serverless production storage without adding an S3 or Vercel Blob adapter. See `STORAGE-001` in [docs/KNOWN_GAPS.md](docs/KNOWN_GAPS.md).

## Operational Docs

- [Production runbook](docs/RUNBOOK.md)
- [Known gaps](docs/KNOWN_GAPS.md)
- [STS SOW](docs/STS_SOW_v1.0_DRAFT.md)
- [RAC roadmap](docs/RAC_v1.0_ROADMAP.md)

## Development Principles

- Keep tenant isolation explicit and testable.
- Prefer shared helpers for auth, billing, audit, pagination, PDF rendering, and storage.
- Keep route handlers thin: validate input, authorize, call domain logic, return typed JSON.
- Add schema migrations rather than runtime table drift where possible.
- Leave legacy modules better documented when touching them.
