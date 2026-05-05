# Smart Mobility Platform — E2E Test Suite (Layer 3)

Playwright end-to-end tests covering full user flows across all major modules.

## Test Layers

| Layer | Location | Runner | Needs Server? |
|-------|----------|--------|--------------|
| 1 — Unit | `tests/unit/` | Vitest | No |
| 2 — Integration | `tests/integration/` | Vitest | Yes (localhost:3000) |
| 3 — E2E | `tests/e2e/` | Playwright | Yes (localhost:3000) |

## Prerequisites

1. `npm run dev` running on `localhost:3000`
2. `.env.test` pointing to a valid PostgreSQL database (Neon)
3. Playwright browsers installed: `npx playwright install`

## Running Tests

```bash
# Run all E2E specs
npm run test:e2e

# Run specific workflow
npm run test:e2e:finance
npm run test:e2e:fleet
npm run test:e2e:rac
npm run test:e2e:admin
npm run test:e2e:cross

# Interactive UI mode (great for debugging)
npm run test:e2e:ui

# Step-through debugger
npm run test:e2e:debug

# Run all layers (unit + integration + e2e)
npm run test:all
```

## Spec Files

| File | Scope | Tests |
|------|-------|-------|
| `login.spec.ts` | Auth flow | Login, logout, session |
| `platform.spec.ts` | Platform home | Module cards, search |
| `tenant-management.spec.ts` | Admin tenant wizard | CRUD, validation |
| `finance-workflow.spec.ts` | Finance full flow | Invoice → payment → management accounts |
| `fleet-workflow.spec.ts` | Fleet full flow | Vehicle CRUD → status → dashboard |
| `rac-workflow.spec.ts` | RAC full flow | Inquiry → quotation → rental pipeline |
| `admin-workflow.spec.ts` | Admin onboarding | Tenant creation, user management, RBAC |
| `cross-module.spec.ts` | Cross-module | Session persistence, API responses, navigation |

## Architecture

- **`helpers.ts`** — Shared utilities: `createE2ETenant()`, `login()`, `skipIfOffline()`, etc.
- Each spec creates its **own isolated test tenant** in `beforeAll` and cleans up in `afterAll`
- Tests **skip gracefully** if the dev server is not running — no hard failures in CI without a server
- Screenshots and videos are captured on failure (`playwright-report/`)

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SUPER_ADMIN_PASSWORD` | Password for the seeded super-admin user (default: `SuperAdmin123!`) |
