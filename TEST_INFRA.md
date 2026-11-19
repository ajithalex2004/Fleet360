# Test Infrastructure Specification: Fleet360 Platform E2E Suite

## Overview
This document establishes the architecture, test organization, execution tooling, and coverage thresholds for the End-to-End (E2E) testing framework of the Fleet360 platform.

The suite implements a systematic 4-Tier test methodology covering all 40 inventoried features (F01–F40) identified in `PROJECT.md` across Milestones M1 through M5.

---

## Test Architecture & Tier Methodology

```
tests/e2e/
├── tier-helpers.ts                           # Shared E2E HTTP client, auth generators, HMAC signatures, fixtures
├── helpers.ts                                # Browser automation and session persistence helpers
├── tier1-feature-coverage/                   # Tier 1: Happy-path baseline feature tests (>=5 tests per feature)
│   ├── m1-security-runtime.spec.ts           # Features F01–F12 (60 tests)
│   ├── m2-financial-vat-gl.spec.ts           # Features F13–F22 (50 tests)
│   ├── m3-operations-driver-app.spec.ts      # Features F23–F31 (45 tests)
│   ├── m4-ai-devops-hygiene.spec.ts          # Features F32–F39 (40 tests)
│   └── m5-test-readiness.spec.ts             # Feature F40 (5 tests)
├── tier2-boundary-corner/                    # Tier 2: Boundary, limit, null/empty, & error tests (>=5 tests per feature)
│   ├── m1-security-boundaries.spec.ts        # Features F01–F12 boundaries (60 tests)
│   ├── m2-financial-boundaries.spec.ts       # Features F13–F22 boundaries (50 tests)
│   ├── m3-operations-boundaries.spec.ts      # Features F23–F31 boundaries (45 tests)
│   ├── m4-ai-devops-boundaries.spec.ts       # Features F32–F39 boundaries (40 tests)
│   └── m5-readiness-boundaries.spec.ts       # Feature F40 boundaries (5 tests)
├── tier3-cross-feature/                      # Tier 3: Pairwise cross-feature interactions (15 tests)
│   └── cross-feature-interactions.spec.ts    # Inter-module state & control flow pairs
└── tier4-application-scenarios/              # Tier 4: Real-world operational multi-module flows (5 tests)
    └── real-world-flows.spec.ts              # End-to-end multi-party business workflows
```

---

## Tier Summary & Test Counts

| Tier | Purpose | Coverage Criteria | Total Tests |
|------|---------|-------------------|-------------|
| **Tier 1** | Primary Feature Coverage | Isolated happy-path tests verifying functional contracts for all features F01–F40 | **200 tests** |
| **Tier 2** | Boundary & Corner Cases | Extreme values, limits, null/empty inputs, size caps, and negative error codes (400, 401, 403, 422) | **200 tests** |
| **Tier 3** | Cross-Feature Interactions | Pairwise combinations across modules sharing state, control flow, auth, or GL postings | **15 tests** |
| **Tier 4** | Real-World Application Scenarios | Complete end-to-end multi-module operational flows (Driver shift, Exchange, Maintenance, RAC, School Bus) | **5 flows** |
| **Total** | **Comprehensive E2E Suite** | **100% Feature Inventory Coverage across Tiers 1–4** | **420 tests** |

---

## Runner & Execution Commands

### Prerequisites
1. Local dependencies installed: `npm install`
2. Playwright browsers installed: `npx playwright install chromium`
3. Database environment loaded: `.env.test` or local database configuration

### Standard Commands

```bash
# 1. Run all E2E tests (Standard Command)
npm run test:e2e

# 2. Run all new 4-tier requirement tests specifically
npx playwright test tests/e2e/tier1-feature-coverage tests/e2e/tier2-boundary-corner tests/e2e/tier3-cross-feature tests/e2e/tier4-application-scenarios

# 3. Run individual tiers
npx playwright test tests/e2e/tier1-feature-coverage
npx playwright test tests/e2e/tier2-boundary-corner
npx playwright test tests/e2e/tier3-cross-feature
npx playwright test tests/e2e/tier4-application-scenarios

# 4. List all tests without execution
npx playwright test tests/e2e/tier1-feature-coverage tests/e2e/tier2-boundary-corner tests/e2e/tier3-cross-feature tests/e2e/tier4-application-scenarios --list

# 5. Interactive UI mode
npm run test:e2e:ui
```

---

## Offline & CI Resilience Contract

- **Pre-flight Probe (`isServerAvailable`)**: The test suite probes `http://127.0.0.1:3000` and `http://localhost:3000` via `/api/health` with a fast timeout.
- **Graceful Skip (`skipIfOffline`)**: When running in an environment without an active dev server (e.g., cold build agents or linting steps), tests gracefully skip using Playwright's `test.skip()`, ensuring the command exits cleanly with code `0`.
- **Live Assertion**: When the dev server is active, opaque-box HTTP requests execute against live route handlers, validating HTTP status codes, security headers, response bodies, and transactional integrity.

---

## Coverage Thresholds & Quality Gates

1. **Feature Coverage**: 100% of inventoried features (F01–F40) must have at least 5 Tier 1 tests and 5 Tier 2 tests.
2. **Error Code Fidelity**: Negative tests must assert exact HTTP status codes (400, 401, 403, 422, 429) rather than generic 500 server crashes.
3. **Execution Safety**: Tests must enforce single-worker execution (`workers: 1`) to eliminate race conditions and database state collisions during multi-tenant transactions.
