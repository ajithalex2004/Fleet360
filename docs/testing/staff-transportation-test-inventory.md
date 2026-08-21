# Staff Transportation Module — Test Inventory

> **Module key:** `bus-ops` · **Display name:** `Staff Transportation` (`src/lib/modules.ts:188-202`)
> **Tenant UI root:** `/bus-ops` · **API root:** `/api/bus-ops/*` · **Driver app:** `/api/driver-app/*` + `mobile-app/src/app/driver-app/*`
> **Counted surface (this snapshot):** 36 admin pages · 70 admin API routes · 26 driver-app API routes · 24 Prisma models · 6 lib helpers · 1 cron route (`outbox-publish`) + 1 trip lifecycle cron (`auto-close-trips`).

This file is the **master test inventory** — every item that *could* be covered by a test, organised by surface. Use it as the index when planning new test cases; each entry maps to a file path that exists today. No code in the codebase is modified by reading this file.

---

## 1. Menu Items (Admin UI Pages) — 36 pages

All admin pages live under `src/app/(app)/bus-ops/**`. Each one is a Next.js App Router `page.tsx`. They render inside the auth-gated layout, so all are protected by the session cookie.

### 1.1 Operations & Dispatch
| # | Path | File | Purpose |
|---|---|---|---|
| M-01 | `/bus-ops` | `src/app/(app)/bus-ops/page.tsx` | Module dashboard / landing page |
| M-02 | `/bus-ops/dispatch` | `src/app/(app)/bus-ops/dispatch/page.tsx` | Live dispatch board (today's trips, status pills) |
| M-03 | `/bus-ops/live-map` | `src/app/(app)/bus-ops/live-map/page.tsx` | Real-time vehicle GPS / route map |
| M-04 | `/bus-ops/gis` | `src/app/(app)/bus-ops/gis/page.tsx` | GIS layers (routes, stops, geofences) |
| M-05 | `/bus-ops/fleet-positions` (route) | n/a (API only) | (Backed by `/api/bus-ops/fleet-positions`) |

### 1.2 Planning & Scheduling
| # | Path | File | Purpose |
|---|---|---|---|
| M-06 | `/bus-ops/routes` | `src/app/(app)/bus-ops/routes/page.tsx` | Bus route CRUD list |
| M-07 | `/bus-ops/route-planner` | `src/app/(app)/bus-ops/route-planner/page.tsx` | Visual route planner (stops + ordering) |
| M-08 | `/bus-ops/headway` | `src/app/(app)/bus-ops/headway/page.tsx` | Headway rule editor (clock-face beat) |
| M-09 | `/bus-ops/schedule-templates` | `src/app/(app)/bus-ops/schedule-templates/page.tsx` | Recurring template CRUD |
| M-10 | `/bus-ops/schedules` | `src/app/(app)/bus-ops/schedules/page.tsx` | Concrete dated trip list |
| M-11 | `/bus-ops/optimisation` | `src/app/(app)/bus-ops/optimisation/page.tsx` | Route-optimisation preview |
| M-12 | `/bus-ops/demand-forecast` | `src/app/(app)/bus-ops/demand-forecast/page.tsx` | Demand forecast view |
| M-13 | `/bus-ops/plan` | `src/app/(app)/bus-ops/plan/page.tsx` | Roster / block plan list |
| M-14 | `/bus-ops/cba-rules` | `src/app/(app)/bus-ops/cba-rules/page.tsx` | CBA (Collective Bargaining Agreement) rule editor |

### 1.3 People
| # | Path | File | Purpose |
|---|---|---|---|
| M-15 | `/bus-ops/staff` | `src/app/(app)/bus-ops/staff/page.tsx` | Staff / employee directory |
| M-16 | `/bus-ops/drivers` | `src/app/(app)/bus-ops/drivers/page.tsx` | Driver directory + assignments |
| M-17 | `/bus-ops/driver` | `src/app/(app)/bus-ops/driver/page.tsx` | Single-driver detail (driver-side view) |
| M-18 | `/bus-ops/driver/profile` | `src/app/(app)/bus-ops/driver/profile/page.tsx` | Driver profile editor |
| M-19 | `/bus-ops/driver/trip/[id]` | `src/app/(app)/bus-ops/driver/trip/[id]/page.tsx` | Driver-side single trip view |
| M-20 | `/bus-ops/driver/trip/[id]/qr` | `src/app/(app)/bus-ops/driver/trip/[id]/qr/page.tsx` | Driver-side trip QR manifest |
| M-21 | `/bus-ops/driver/trip/[id]/pretrip` | `src/app/(app)/bus-ops/driver/trip/[id]/pretrip/page.tsx` | Driver-side pre-trip check |
| M-22 | `/bus-ops/driver/incident` | `src/app/(app)/bus-ops/driver/incident/page.tsx` | Driver incident reporter |
| M-23 | `/bus-ops/passengers` | `src/app/(app)/bus-ops/passengers/page.tsx` | Passengers on a route list |
| M-24 | `/bus-ops/passenger` | `src/app/(app)/bus-ops/passenger/page.tsx` | Passenger list (per trip) |
| M-25 | `/bus-ops/passenger/profile` | `src/app/(app)/bus-ops/passenger/profile/page.tsx` | Single passenger detail |
| M-26 | `/bus-ops/passenger/waitlist` | `src/app/(app)/bus-ops/passenger/waitlist/page.tsx` | Waitlist overview |
| M-27 | `/bus-ops/passenger/board` | `src/app/(app)/bus-ops/passenger/board/page.tsx` | Boarding manifest view |
| M-28 | `/bus-ops/passenger/app` | `src/app/(app)/bus-ops/passenger/app/page.tsx` | Staff-facing PWA landing (driver/staff portal) |
| M-29 | `/bus-ops/passenger/absence` | `src/app/(app)/bus-ops/passenger/absence/page.tsx` | Absence request form (staff) |
| M-30 | `/bus-ops/passenger/today` (API) | n/a | (Backed by `/api/bus-ops/passenger/today`) |
| M-31 | `/bus-ops/transport-requests` | `src/app/(app)/bus-ops/transport-requests/page.tsx` | Transport request queue (enrolment / change) |
| M-32 | `/bus-ops/transport-calendars` | `src/app/(app)/bus-ops/transport-calendars/page.tsx` | Calendar list (active dates / exceptions) |
| M-33 | `/bus-ops/trips/[id]` | `src/app/(app)/bus-ops/trips/[id]/page.tsx` | Single trip detail |

### 1.4 Fleet / Hardware
| # | Path | File | Purpose |
|---|---|---|---|
| M-34 | `/bus-ops/gateways` | `src/app/(app)/bus-ops/gateways/page.tsx` | BLE gateway management |
| M-35 | `/bus-ops/geofences` | `src/app/(app)/bus-ops/geofences/page.tsx` | Geofence editor |
| M-36 | `/bus-ops/incidents` | `src/app/(app)/bus-ops/incidents/page.tsx` | Incident list |

### 1.5 Analytics & Reporting
| # | Path | File | Purpose |
|---|---|---|---|
| M-37 | `/bus-ops/analytics` | `src/app/(app)/bus-ops/analytics/page.tsx` | Analytics landing |
| M-38 | `/bus-ops/powerbi` | `src/app/(app)/bus-ops/powerbi/page.tsx` | Power BI embed |

### 1.6 Driver Mobile App (separate bundle, `mobile-app/`)
| # | Path | File | Purpose |
|---|---|---|---|
| D-01 | `/driver-app` | `mobile-app/src/app/driver-app/page.tsx` | Driver home |
| D-02 | `/driver-app/today` | `mobile-app/src/app/driver-app/today/page.tsx` | Today's assignments |
| D-03 | `/driver-app/trip-history` | `mobile-app/src/app/driver-app/trip-history/page.tsx` | Past trips |
| D-04 | `/driver-app/shift-checklist` | `mobile-app/src/app/driver-app/shift-checklist/page.tsx` | Pre-shift inspection |
| D-05 | `/driver-app/shift-ended` | `mobile-app/src/app/driver-app/shift-ended/page.tsx` | Post-shift summary |
| D-06 | `/driver-app/shift-history` | `mobile-app/src/app/driver-app/shift-history/page.tsx` | Past shifts |
| D-07 | `/driver-app/dvirs/new` | `mobile-app/src/app/driver-app/dvirs/new/page.tsx` | New DVIR (defect report) |
| D-08 | `/driver-app/fuel-entry` | `mobile-app/src/app/driver-app/fuel-entry/page.tsx` | Fuel log entry |
| D-09 | `/driver-app/expenses` | `mobile-app/src/app/driver-app/expenses/page.tsx` | Expense entry |
| D-10 | `/driver-app/reports` | `mobile-app/src/app/driver-app/reports/page.tsx` | Reports list |
| D-11 | `/driver-app/report` | `mobile-app/src/app/driver-app/report/page.tsx` | New report |
| D-12 | `/driver-app/behavior` | `mobile-app/src/app/driver-app/behavior/page.tsx` | Behavior events (harsh braking, speeding) |
| D-13 | `/driver-app/enroll-biometric` | `mobile-app/src/app/driver-app/enroll-biometric/page.tsx` | WebAuthn enrolment |
| D-14 | `/driver-app/menu` | `mobile-app/src/app/driver-app/menu/page.tsx` | Driver menu |
| D-15 | `/driver-app/navigate` | `mobile-app/src/app/driver-app/navigate/page.tsx` | Turn-by-turn navigation to next stop |

---

## 2. APIs — 96 routes

### 2.1 Admin API (`/api/bus-ops/*`) — 70 routes

#### 2.1.1 Routes & Variants
| # | Method | Path | File |
|---|---|---|---|
| A-01 | POST | `/api/bus-ops/routes` | `src/app/api/bus-ops/routes/route.ts` |
| A-02 | GET | `/api/bus-ops/routes` | `src/app/api/bus-ops/routes/route.ts` |
| A-03 | GET | `/api/bus-ops/routes/estimate` | `src/app/api/bus-ops/routes/estimate/route.ts` |
| A-04 | POST | `/api/bus-ops/routes/optimisation-preview` | `src/app/api/bus-ops/routes/optimisation-preview/route.ts` |
| A-05 | GET | `/api/bus-ops/routes/[id]` | `src/app/api/bus-ops/routes/[id]/route.ts` |
| A-06 | PATCH | `/api/bus-ops/routes/[id]` | `src/app/api/bus-ops/routes/[id]/route.ts` |
| A-07 | DELETE | `/api/bus-ops/routes/[id]` | `src/app/api/bus-ops/routes/[id]/route.ts` |
| A-08 | GET | `/api/bus-ops/routes/[id]/stops` | `src/app/api/bus-ops/routes/[id]/stops/route.ts` |
| A-09 | GET | `/api/bus-ops/routes/[id]/variants` | `src/app/api/bus-ops/routes/[id]/variants/route.ts` |
| A-10 | GET | `/api/bus-ops/route-variants/[variantId]/versions` | `src/app/api/bus-ops/route-variants/[variantId]/versions/route.ts` |
| A-11 | GET | `/api/bus-ops/route-stops` | `src/app/api/bus-ops/route-stops/route.ts` |
| A-12 | GET | `/api/bus-ops/route-types` | `src/app/api/bus-ops/route-types/route.ts` |

#### 2.1.2 Schedules (concrete dated trips)
| # | Method | Path | File |
|---|---|---|---|
| A-13 | POST | `/api/bus-ops/schedules` | `src/app/api/bus-ops/schedules/route.ts` |
| A-14 | GET | `/api/bus-ops/schedules` | `src/app/api/bus-ops/schedules/route.ts` |
| A-15 | GET | `/api/bus-ops/schedules/[id]` | `src/app/api/bus-ops/schedules/[id]/route.ts` |
| A-16 | PATCH | `/api/bus-ops/schedules/[id]` | `src/app/api/bus-ops/schedules/[id]/route.ts` |
| A-17 | POST | `/api/bus-ops/schedules/[id]/depart` | `src/app/api/bus-ops/schedules/[id]/depart/route.ts` |
| A-18 | POST | `/api/bus-ops/schedules/[id]/complete` | `src/app/api/bus-ops/schedules/[id]/complete/route.ts` |
| A-19 | POST | `/api/bus-ops/schedules/[id]/cancel` | `src/app/api/bus-ops/schedules/[id]/cancel/route.ts` |
| A-20 | GET | `/api/bus-ops/schedules/[id]/eta` | `src/app/api/bus-ops/schedules/[id]/eta/route.ts` |
| A-21 | GET | `/api/bus-ops/schedules/[id]/passengers` | `src/app/api/bus-ops/schedules/[id]/passengers/route.ts` |
| A-22 | POST | `/api/bus-ops/schedules/[id]/expand-roster` | `src/app/api/bus-ops/schedules/[id]/expand-roster/route.ts` |
| A-23 | POST | `/api/bus-ops/schedules/[id]/qr-token` | `src/app/api/bus-ops/schedules/[id]/qr-token/route.ts` |
| A-24 | GET | `/api/bus-ops/schedules/[id]/manifest/pdf` | `src/app/api/bus-ops/schedules/[id]/manifest/pdf/route.ts` |
| A-25 | POST | `/api/bus-ops/schedules/[id]/pretrip-check` | `src/app/api/bus-ops/schedules/[id]/pretrip-check/route.ts` |
| A-26 | POST | `/api/bus-ops/schedules/[id]/notify` | `src/app/api/bus-ops/schedules/[id]/notify/route.ts` |
| A-27 | POST | `/api/bus-ops/schedules/sweep-waitlist` | `src/app/api/bus-ops/schedules/sweep-waitlist/route.ts` |

#### 2.1.3 Schedule Templates
| # | Method | Path | File |
|---|---|---|---|
| A-28 | POST | `/api/bus-ops/schedule-templates` | `src/app/api/bus-ops/schedule-templates/route.ts` |
| A-29 | GET | `/api/bus-ops/schedule-templates` | `src/app/api/bus-ops/schedule-templates/route.ts` |
| A-30 | GET | `/api/bus-ops/schedule-templates/[id]` | `src/app/api/bus-ops/schedule-templates/[id]/route.ts` |
| A-31 | PATCH | `/api/bus-ops/schedule-templates/[id]` | `src/app/api/bus-ops/schedule-templates/[id]/route.ts` |
| A-32 | DELETE | `/api/bus-ops/schedule-templates/[id]` | `src/app/api/bus-ops/schedule-templates/[id]/route.ts` |
| A-33 | POST | `/api/bus-ops/schedule-templates/[id]/generate` | `src/app/api/bus-ops/schedule-templates/[id]/generate/route.ts` |

#### 2.1.4 Calendars
| # | Method | Path | File |
|---|---|---|---|
| A-34 | POST | `/api/bus-ops/transport-calendars` | `src/app/api/bus-ops/transport-calendars/route.ts` |
| A-35 | GET | `/api/bus-ops/transport-calendars` | `src/app/api/bus-ops/transport-calendars/route.ts` |
| A-36 | GET | `/api/bus-ops/transport-calendars/[id]` | `src/app/api/bus-ops/transport-calendars/[id]/route.ts` |
| A-37 | PATCH | `/api/bus-ops/transport-calendars/[id]` | `src/app/api/bus-ops/transport-calendars/[id]/route.ts` |
| A-38 | DELETE | `/api/bus-ops/transport-calendars/[id]` | `src/app/api/bus-ops/transport-calendars/[id]/route.ts` |
| A-39 | GET | `/api/bus-ops/transport-calendars/[id]/entries` | `src/app/api/bus-ops/transport-calendars/[id]/entries/route.ts` |
| A-40 | POST | `/api/bus-ops/transport-calendars/[id]/entries` | `src/app/api/bus-ops/transport-calendars/[id]/entries/route.ts` |
| A-41 | PATCH | `/api/bus-ops/transport-calendars/[id]/entries/[entryId]` | `src/app/api/bus-ops/transport-calendars/[id]/entries/[entryId]/route.ts` |
| A-42 | DELETE | `/api/bus-ops/transport-calendars/[id]/entries/[entryId]` | `src/app/api/bus-ops/transport-calendars/[id]/entries/[entryId]/route.ts` |

#### 2.1.5 Passengers & Route Passengers
| # | Method | Path | File |
|---|---|---|---|
| A-43 | GET | `/api/bus-ops/passengers` | `src/app/api/bus-ops/passengers/route.ts` |
| A-44 | GET | `/api/bus-ops/passengers/[id]` | `src/app/api/bus-ops/passengers/[id]/route.ts` |
| A-45 | GET | `/api/bus-ops/passenger/today` | `src/app/api/bus-ops/passenger/today/route.ts` |
| A-46 | GET | `/api/bus-ops/passenger/waitlist` | `src/app/api/bus-ops/passenger/waitlist/route.ts` |
| A-47 | POST | `/api/bus-ops/route-passengers` | `src/app/api/bus-ops/route-passengers/route.ts` |
| A-48 | GET | `/api/bus-ops/route-passengers` | `src/app/api/bus-ops/route-passengers/route.ts` |
| A-49 | PATCH | `/api/bus-ops/route-passengers/[id]` | `src/app/api/bus-ops/route-passengers/[id]/route.ts` |
| A-50 | DELETE | `/api/bus-ops/route-passengers/[id]` | `src/app/api/bus-ops/route-passengers/[id]/route.ts` |
| A-51 | POST | `/api/bus-ops/route-passengers/bulk-import` | `src/app/api/bus-ops/route-passengers/bulk-import/route.ts` |

#### 2.1.6 People (Staff / Drivers)
| # | Method | Path | File |
|---|---|---|---|
| A-52 | POST | `/api/bus-ops/staff` | `src/app/api/bus-ops/staff/route.ts` |
| A-53 | GET | `/api/bus-ops/staff` | `src/app/api/bus-ops/staff/route.ts` |
| A-54 | GET | `/api/bus-ops/staff/[id]` | `src/app/api/bus-ops/staff/[id]/route.ts` |
| A-55 | PATCH | `/api/bus-ops/staff/[id]` | `src/app/api/bus-ops/staff/[id]/route.ts` |
| A-56 | POST | `/api/bus-ops/staff/[id]/ble-tag` | `src/app/api/bus-ops/staff/[id]/ble-tag/route.ts` |
| A-57 | POST | `/api/bus-ops/staff/[id]/rfid-tag` | `src/app/api/bus-ops/staff/[id]/rfid-tag/route.ts` |
| A-58 | GET | `/api/bus-ops/drivers` | `src/app/api/bus-ops/drivers/route.ts` |
| A-59 | GET | `/api/bus-ops/driver-performance` | `src/app/api/bus-ops/driver-performance/route.ts` |
| A-60 | POST | `/api/bus-ops/driver-performance/recompute` | `src/app/api/bus-ops/driver-performance/recompute/route.ts` |

#### 2.1.7 Transport Requests & Enrolments
| # | Method | Path | File |
|---|---|---|---|
| A-61 | POST | `/api/bus-ops/transport-requests` | `src/app/api/bus-ops/transport-requests/route.ts` |
| A-62 | GET | `/api/bus-ops/transport-requests` | `src/app/api/bus-ops/transport-requests/route.ts` |
| A-63 | GET | `/api/bus-ops/transport-requests/[id]` | `src/app/api/bus-ops/transport-requests/[id]/route.ts` |
| A-64 | PATCH | `/api/bus-ops/transport-requests/[id]` | `src/app/api/bus-ops/transport-requests/[id]/route.ts` |
| A-65 | POST | `/api/bus-ops/transport-enrollments` | `src/app/api/bus-ops/transport-enrollments/route.ts` |
| A-66 | GET | `/api/bus-ops/transport-enrollments` | `src/app/api/bus-ops/transport-enrollments/route.ts` |
| A-67 | PATCH | `/api/bus-ops/transport-enrollments/[id]` | `src/app/api/bus-ops/transport-enrollments/[id]/route.ts` |

#### 2.1.8 Hardware (Vehicles, Gateways, Geofences, Trip Logs, Incidents)
| # | Method | Path | File |
|---|---|---|---|
| A-68 | POST | `/api/bus-ops/vehicles/[id]/location` | `src/app/api/bus-ops/vehicles/[id]/location/route.ts` |
| A-69 | POST | `/api/bus-ops/vehicles/[id]/gateway` | `src/app/api/bus-ops/vehicles/[id]/gateway/route.ts` |
| A-70 | POST | `/api/bus-ops/vehicles/[id]/beacon` | `src/app/api/bus-ops/vehicles/[id]/beacon/route.ts` |
| A-71 | POST | `/api/bus-ops/gateways` | `src/app/api/bus-ops/gateways/route.ts` |
| A-72 | GET | `/api/bus-ops/gateways` | `src/app/api/bus-ops/gateways/route.ts` |
| A-73 | POST | `/api/bus-ops/gateways/[id]/rotate-secret` | `src/app/api/bus-ops/gateways/[id]/rotate-secret/route.ts` |
| A-74 | POST | `/api/bus-ops/gateway/events` | `src/app/api/bus-ops/gateway/events/route.ts` |
| A-75 | GET | `/api/bus-ops/geofences` | `src/app/api/bus-ops/geofences/route.ts` |
| A-76 | POST | `/api/bus-ops/geofences` | `src/app/api/bus-ops/geofences/route.ts` |
| A-77 | GET | `/api/bus-ops/geofences/[id]` | `src/app/api/bus-ops/geofences/[id]/route.ts` |
| A-78 | PATCH | `/api/bus-ops/geofences/[id]` | `src/app/api/bus-ops/geofences/[id]/route.ts` |
| A-79 | POST | `/api/bus-ops/trip-logs` | `src/app/api/bus-ops/trip-logs/route.ts` |
| A-80 | GET | `/api/bus-ops/trip-logs` | `src/app/api/bus-ops/trip-logs/route.ts` |
| A-81 | POST | `/api/bus-ops/incidents` | `src/app/api/bus-ops/incidents/route.ts` |
| A-82 | GET | `/api/bus-ops/incidents` | `src/app/api/bus-ops/incidents/route.ts` |
| A-83 | GET | `/api/bus-ops/incidents/[id]` | `src/app/api/bus-ops/incidents/[id]/route.ts` |
| A-84 | PATCH | `/api/bus-ops/incidents/[id]` | `src/app/api/bus-ops/incidents/[id]/route.ts` |

#### 2.1.9 Planning & Headway
| # | Method | Path | File |
|---|---|---|---|
| A-85 | GET | `/api/bus-ops/headway` | `src/app/api/bus-ops/headway/route.ts` |
| A-86 | POST | `/api/bus-ops/headway` | `src/app/api/bus-ops/headway/route.ts` |
| A-87 | POST | `/api/bus-ops/plan` | `src/app/api/bus-ops/plan/route.ts` |
| A-88 | GET | `/api/bus-ops/plan` | `src/app/api/bus-ops/plan/route.ts` |
| A-89 | POST | `/api/bus-ops/plan/compare` | `src/app/api/bus-ops/plan/compare/route.ts` |
| A-90 | POST | `/api/bus-ops/plan/compute` | `src/app/api/bus-ops/plan/compute/route.ts` |
| A-91 | GET | `/api/bus-ops/plan/[id]` | `src/app/api/bus-ops/plan/[id]/route.ts` |
| A-92 | POST | `/api/bus-ops/plan/[id]/apply` | `src/app/api/bus-ops/plan/[id]/apply/route.ts` |
| A-93 | POST | `/api/bus-ops/cba` | `src/app/api/bus-ops/cba/route.ts` |
| A-94 | GET | `/api/bus-ops/cba` | `src/app/api/bus-ops/cba/route.ts` |

#### 2.1.10 Analytics
| # | Method | Path | File |
|---|---|---|---|
| A-95 | GET | `/api/bus-ops/analytics` | `src/app/api/bus-ops/analytics/route.ts` |
| A-96 | GET | `/api/bus-ops/analytics/cost-breakdown` | `src/app/api/bus-ops/analytics/cost-breakdown/route.ts` |
| A-97 | GET | `/api/bus-ops/analytics/demand-forecast` | `src/app/api/bus-ops/analytics/demand-forecast/route.ts` |
| A-98 | GET | `/api/bus-ops/fleet-positions` | `src/app/api/bus-ops/fleet-positions/route.ts` |
| A-99 | POST | `/api/bus-ops/checkin` | `src/app/api/bus-ops/checkin/route.ts` |

> **Note:** A-01 to A-99 are 99 surface entries but only **70** are admin API **route files** — many entries share a single `route.ts` because that file declares multiple HTTP methods (POST + GET on the same path). Counted by route file, not by method.

### 2.2 Driver Mobile App API (`/api/driver-app/*`) — 26 routes

| # | Method | Path | File |
|---|---|---|---|
| D-API-01 | POST | `/api/driver-app/auth/biometric/register` | `src/app/api/driver-app/auth/biometric/register/route.ts` |
| D-API-02 | POST | `/api/driver-app/auth/biometric/register/finish` | `src/app/api/driver-app/auth/biometric/register/finish/route.ts` |
| D-API-03 | POST | `/api/driver-app/auth/biometric/login/start` | `src/app/api/driver-app/auth/biometric/login/start/route.ts` |
| D-API-04 | POST | `/api/driver-app/auth/biometric/login/finish` | `src/app/api/driver-app/auth/biometric/login/finish/route.ts` |
| D-API-05 | GET | `/api/driver-app/auth/biometric/status` | `src/app/api/driver-app/auth/biometric/status/route.ts` |
| D-API-06 | GET | `/api/driver-app/feature-flags` | `src/app/api/driver-app/feature-flags/route.ts` |
| D-API-07 | POST | `/api/driver-app/heartbeat` | `src/app/api/driver-app/heartbeat/route.ts` |
| D-API-08 | POST | `/api/driver-app/behavior-events` | `src/app/api/driver-app/behavior-events/route.ts` |
| D-API-09 | GET | `/api/driver-app/today/assignments` | `src/app/api/driver-app/today/assignments/route.ts` |
| D-API-10 | POST | `/api/driver-app/trips/[id]/start` | `src/app/api/driver-app/trips/[id]/start/route.ts` |
| D-API-11 | POST | `/api/driver-app/trips/[id]/end` | `src/app/api/driver-app/trips/[id]/end/route.ts` |
| D-API-12 | GET | `/api/driver-app/trips/[id]/geofences` | `src/app/api/driver-app/trips/[id]/geofences/route.ts` |
| D-API-13 | GET | `/api/driver-app/trips/history` | `src/app/api/driver-app/trips/history/route.ts` |
| D-API-14 | GET | `/api/driver-app/shift/current` | `src/app/api/driver-app/shift/current/route.ts` |
| D-API-15 | POST | `/api/driver-app/shift/[id]/end` | `src/app/api/driver-app/shift/[id]/end/route.ts` |
| D-API-16 | GET | `/api/driver-app/shift/[id]` | `src/app/api/driver-app/shift/[id]/route.ts` |
| D-API-17 | GET | `/api/driver-app/shift/[id]/recent-entries` | `src/app/api/driver-app/shift/[id]/recent-entries/route.ts` |
| D-API-18 | GET | `/api/driver-app/shift/[id]/checklist` | `src/app/api/driver-app/shift/[id]/checklist/route.ts` |
| D-API-19 | GET | `/api/driver-app/shift/history` | `src/app/api/driver-app/shift/history/route.ts` |
| D-API-20 | POST | `/api/driver-app/dvir` | `src/app/api/driver-app/dvir/route.ts` |
| D-API-21 | POST | `/api/driver-app/fuel-entries` | `src/app/api/driver-app/fuel-entries/route.ts` |
| D-API-22 | POST | `/api/driver-app/expenses` | `src/app/api/driver-app/expenses/route.ts` |
| D-API-23 | GET | `/api/driver-app/cba/continuous-driving-limit` | `src/app/api/driver-app/cba/continuous-driving-limit/route.ts` |
| D-API-24 | GET | `/api/driver-app/reports` | `src/app/api/driver-app/reports/route.ts` |
| D-API-25 | GET | `/api/driver-app/reports/[id]` | `src/app/api/driver-app/reports/[id]/route.ts` |
| D-API-26 | POST | `/api/driver-app/reports/[id]/cancel` | `src/app/api/driver-app/reports/[id]/cancel/route.ts` |

### 2.3 Cross-Cutting Cron API (relevant to bus-ops)
| # | Method | Path | File |
|---|---|---|---|
| C-01 | POST | `/api/cron/auto-close-trips` | `src/app/api/cron/auto-close-trips/route.ts` |
| C-02 | POST | `/api/cron/outbox-publish` | `src/app/api/cron/outbox-publish/route.ts` |

---

## 3. Database Entities — 24 Prisma models + raw tables

### 3.1 Prisma models (`prisma/schema.prisma`)
| # | Model | Schema/Table | File Location | Purpose |
|---|---|---|---|---|
| DB-01 | `BusRoute` | `public.bus_routes` | `prisma/schema.prisma:1714` | Master bus route definition |
| DB-02 | `RouteStop` | `public.route_stops` | `prisma/schema.prisma:1810` | Ordered stops on a route |
| DB-03 | `RoutePassenger` | `public.route_passengers` | `prisma/schema.prisma:1862` | Persistent enrolment of a staff member to a route |
| DB-04 | `BulkImportJob` | `public.bulk_import_jobs` | `prisma/schema.prisma:1901` | Idempotency cache for bulk-import route (R10) |
| DB-05 | `BusOpsScheduleTemplate` | `public.bus_ops_schedule_templates` | `prisma/schema.prisma:1928` | Recurring rule ("Marina MORNING SUN-THU 07:00") |
| DB-06 | `TransportCalendar` | `public.transport_calendars` | `prisma/schema.prisma:1964` | Active-date / exception-date window |
| DB-07 | `TransportCalendarEntry` | `public.transport_calendar_entries` | `prisma/schema.prisma:1985` | Per-date entry (active / blackout / exception) |
| DB-08 | `BusRouteType` | `public.bus_route_types` | `prisma/schema.prisma:2001` | Route-type lookup (e.g. EXPRESS, LOCAL) |
| DB-09 | `BusGpsPing` | `public.bus_gps_pings` | `prisma/schema.prisma:2025` | Per-ping GPS update (live map) |
| DB-10 | `TripStopVisit` | `public.trip_stop_visits` | `prisma/schema.prisma:2045` | Per-stop arrival/departure record |
| DB-11 | `TripSchedule` | `public.trip_schedules` | `prisma/schema.prisma:2067` | Concrete dated trip (lifecycle SCHEDULED→DEPARTED→IN_TRANSIT→COMPLETED/CANCELLED) |
| DB-12 | `CbaRuleSet` | `public.cba_rule_sets` | `prisma/schema.prisma:2177` | CBA (Collective Bargaining) ruleset container |
| DB-13 | `TripPassenger` | `public.trip_passengers` | `prisma/schema.prisma:2211` | Per-trip roster (status lifecycle) |
| DB-14 | `TripLog` | `public.trip_logs` | `prisma/schema.prisma:2235` | Trip telemetry (fuel, boardings, ETA) |
| DB-15 | `StaffMember` | `workforce.employees` | `prisma/schema.prisma:2305` | Staff/employee master record |
| DB-16 | `TransportEnrollment` | `public.transport_enrollments` | `prisma/schema.prisma:2347` | Per-employee route/stop preferences |
| DB-17 | `StaffTransportRequest` | `public.staff_transport_requests` | `prisma/schema.prisma:2373` | Staff self-service transport requests (TEMPORARY/ABSENCE) |
| DB-18 | `BleGateway` | `public.ble_gateways` | `prisma/schema.prisma:2395` | BLE gateway device (per-vehicle) |
| DB-19 | `BoardingEvent` | `public.boarding_events` | `prisma/schema.prisma:2493` | Board/alight event log (BLE/QR/RFID/etc.) |
| DB-20 | `BusPreTripCheck` | `public.bus_pre_trip_checks` | `prisma/schema.prisma:2522` | DVIR-style pre-trip inspection |
| DB-21 | `FuelLog` | `public.fuel_logs` | `prisma/schema.prisma:2688` | Fuel transaction (also written to `finance.finance_expenses`) |
| DB-22 | `DriverShift` | `public.driver_shifts` | `prisma/schema.prisma:2764` | Driver shift (start/end/total_hours) |
| DB-23 | `TransportRequest` | `public.transport_requests` | `prisma/schema.prisma:5459` | Admin/dispatcher-side transport requests (separate from staff self-service) |
| DB-24 | `EventOutbox` | `public.event_outbox` | `prisma/schema.prisma:5313` | Outbox pattern row (event_type + payload) |
| DB-25 | `EventConsumerInbox` | `public.event_consumer_inbox` | `prisma/schema.prisma:5361` | Per-consumer idempotency guard |
| DB-26 | `DvirDefect` | `public.dvir_defects` | `prisma/schema.prisma:5186` | Per-defect row from a DVIR |
| DB-27 | `VehicleIssueReport` | `public.vehicle_issue_reports` | `prisma/schema.prisma:5217` | Driver-submitted ad-hoc issue report |

### 3.2 Raw Tables (no Prisma model — accessed via `$queryRawUnsafe`)
| # | Table | Used by |
|---|---|---|
| RT-01 | `bulk_import_jobs` (also has Prisma model DB-04) | referenced from `scripts/apply-pending-migrations.cjs` |
| RT-02 | `tenant_admin_nav_permissions` | `tests/setup.ts:cleanupTenant` |
| RT-03 | `finance_invoices` | `tests/setup.ts:cleanupTenant` |
| RT-04 | `vehicles` (tenant_id added outside schema) | `tests/setup.ts:cleanupTenant` |
| RT-05 | `school_bus_students` | `tests/setup.ts:cleanupTenant` |
| RT-06 | `incidents` (legacy, `operations.incidents` is the new home) | `tests/setup.ts:cleanupTenant` |
| RT-07 | `logistics_trips` | `tests/setup.ts:cleanupTenant` |
| RT-08 | `rental_agreements` | `tests/setup.ts:cleanupTenant` |
| RT-09 | `finance.finance_expenses` | `src/lib/bus-ops/finance-bridge.ts:225` |
| RT-10 | `finance.finance_invoices` (AR mirror) | `src/lib/finance/module-ledger.ts` (via bridge) |
| RT-11 | `driver_shifts` (raw) | `src/lib/bus-ops/finance-bridge.ts:95` |
| RT-11 | `fuel_logs` (raw) | `src/lib/bus-ops/finance-bridge.ts:78` |

### 3.3 Postgres Enums (DB-layer vocabulary)
| # | Enum | Defined at | Values |
|---|---|---|---|
| EN-01 | `TransportRequestType` | `schema.prisma:2042+` | `NEW_ENROLLMENT, ROUTE_CHANGE, STOP_CHANGE, TEMP_TRIP, SPECIAL` |
| EN-02 | `TransportRequestStatus` | `schema.prisma:2050+` | `PENDING, APPROVED, REJECTED, FULFILLED` |
| EN-03 | `BoardingEventType` | `schema.prisma:2057+` | `BOARDED, ALIGHTED, NO_SHOW` |
| EN-04 | `BoardingEventSource` | `schema.prisma:2063+` | `BLE, QR, NFC, MANUAL, DRIVER_APP, GEOFENCE` |
| EN-05 | `TripPassengerStatus` | `schema.prisma:2078+` | `CONFIRMED, ABSENT, BOARDED, ALIGHTED, NO_SHOW, CANCELLED, WAITLISTED` |

### 3.4 Postgres Triggers (R6 fix)
| # | Trigger | Table | Migration |
|---|---|---|---|
| TR-01 | `trip_schedules_status_transition_check` | `trip_schedules` | `prisma/migrations/20260813100000_trip_schedule_state_machine/migration.sql` — BEFORE UPDATE OF status trigger that mirrors `TRIP_TRANSITIONS` in `state-machines.ts:40-46` |

---

## 4. Business Rules

Each rule has a stable ID. Format: `BR-<area>-<n>`.

### 4.1 Trip lifecycle (`src/lib/bus-ops/state-machines.ts:19-46`)
| # | Rule | Source |
|---|---|---|
| BR-TRIP-01 | `SCHEDULED → DEPARTED` allowed (bus left) | `state-machines.ts:40-46` |
| BR-TRIP-02 | `SCHEDULED → CANCELLED` allowed (trip called off) | `state-machines.ts:40-46` |
| BR-TRIP-03 | `SCHEDULED → COMPLETED` **blocked** (audit risk: skips no-show marking) | `state-machines.ts:32-35` |
| BR-TRIP-04 | `DEPARTED → IN_TRANSIT` allowed (first stop reached) | `state-machines.ts:41` |
| BR-TRIP-05 | `DEPARTED → COMPLETED` allowed (short/express trips) | `state-machines.ts:41` |
| BR-TRIP-06 | `DEPARTED → CANCELLED` allowed | `state-machines.ts:41` |
| BR-TRIP-07 | `IN_TRANSIT → COMPLETED` allowed | `state-machines.ts:42` |
| BR-TRIP-08 | `IN_TRANSIT → CANCELLED` allowed | `state-machines.ts:42` |
| BR-TRIP-09 | `COMPLETED` is terminal | `state-machines.ts:43` |
| BR-TRIP-10 | `CANCELLED` is terminal | `state-machines.ts:44` |
| BR-TRIP-11 | DB-level: any illegal transition raises `check_violation` via the BEFORE UPDATE trigger (TR-01) | `prisma/migrations/20260813100000_*/migration.sql` |

### 4.2 Passenger lifecycle (`src/lib/bus-ops/state-machines.ts:72-106`)
| # | Rule | Source |
|---|---|---|
| BR-PSG-01 | `WAITLISTED → CONFIRMED` (sweep-waitlist promotion) | `state-machines.ts:99` |
| BR-PSG-02 | `WAITLISTED → CANCELLED` | `state-machines.ts:99` |
| BR-PSG-03 | `CONFIRMED → BOARDED` (BLE detected or QR scan) | `state-machines.ts:100` |
| BR-PSG-04 | `CONFIRMED → ABSENT` (bus arrived, passenger not there) | `state-machines.ts:100` |
| BR-PSG-05 | `CONFIRMED → NO_SHOW` (trip departed without them) | `state-machines.ts:100` |
| BR-PSG-06 | `CONFIRMED → CANCELLED` | `state-machines.ts:100` |
| BR-PSG-07 | `BOARDED → ALIGHTED` | `state-machines.ts:101` |
| BR-PSG-08 | `ALIGHTED, ABSENT, NO_SHOW, CANCELLED` all terminal | `state-machines.ts:102-105` |
| BR-PSG-09 | `ABSENT` = per-stop miss; `NO_SHOW` = whole-trip miss (set by `schedules/[id]/depart`) | `state-machines.ts:93-96` |

### 4.3 Bulk import (R10 — `src/app/api/bus-ops/route-passengers/bulk-import/route.ts`)
| # | Rule | Source |
|---|---|---|
| BR-IMP-01 | `?dryRun=true` skips all writes | `route.ts:83` |
| BR-IMP-02 | `?idempotencyKey=…` with body-hash collision returns cached result | `route.ts:110-125` |
| BR-IMP-03 | `?idempotencyKey=…` reused with different body returns **409** | `route.ts:111-118` |
| BR-IMP-04 | Idempotency key max length 200 chars (else 400) | `route.ts:48,86-91` |
| BR-IMP-05 | Cached entries expire after 24h | `route.ts:49,110` (`IDEMPOTENCY_TTL_HOURS`) |
| BR-IMP-06 | Max 5000 rows per import | `route.ts:97-98` |
| BR-IMP-07 | Empty rows array returns 400 | `route.ts:96-97` |
| BR-IMP-08 | Bad row in batch does NOT abort; per-row errors reported | `route.ts:150-155` |
| BR-IMP-09 | Overlap protection: duplicate active enrolment is **skipped** (not errored) | `route.ts:188-197` |
| BR-IMP-10 | `pickupTime`/`dropoffTime` must be `HH:MM` 24h | `route.ts:47,176-177` |
| BR-IMP-11 | `effectiveTo` must be ≥ `effectiveFrom` | `route.ts:181-184` |
| BR-IMP-12 | Stop name must exist on the resolved route | `route.ts:163-174` |
| BR-IMP-13 | Route resolution: prefer `routeCode`, fall back to `routeName` | `route.ts:157-160` |
| BR-IMP-14 | Staff lookup: `employeeId` must exist in caller's tenant | `route.ts:130-142,153-155` |

### 4.4 BLE gateway & presence detection (`src/lib/bus-gateway.ts`)
| # | Rule | Source |
|---|---|---|
| BR-BLE-01 | HMAC-SHA256 signature required; `timingSafeEqual` comparison | `bus-gateway.ts:31-44` |
| BR-BLE-02 | `verifyGatewaySignatureWithSecret` returns false on missing secret or signature | `bus-gateway.ts:36` |
| BR-BLE-03 | `resolveGatewaySecret('')` falls back to `BLE_GATEWAY_SHARED_SECRET` env (empty string is sentinel) | `bus-gateway.ts:70-73` |
| BR-BLE-04 | Default RSSI threshold for boarding: `-75 dBm` | `bus-gateway.ts:137-140` (`DEFAULT_DETECTOR.rssiThresholdDbm`) |
| BR-BLE-05 | Min sample count to count a board: 3 | `bus-gateway.ts:138` |
| BR-BLE-06 | Presence grace before declaring alight: 10s | `bus-gateway.ts:139` |
| BR-BLE-07 | Outside range but previously present → still preserve presence (drift tolerated) | `bus-gateway.ts:184-193` |
| BR-BLE-08 | Unseen ≥ grace seconds while previously present → ALIGHT transition | `bus-gateway.ts:196-215` |

### 4.5 Waitlist sweep (`src/app/api/bus-ops/schedules/sweep-waitlist/route.ts`)
| # | Rule | Source |
|---|---|---|
| BR-SW-01 | Phase 1: ABSENCE requests (`requestType='TEMPORARY'` + `reason starts with 'ABSENCE'`) flip CONFIRMED passengers to ABSENT | `route.ts:76-85` |
| BR-SW-02 | Marked requests transition to FULFILLED after sweep | `route.ts:127-132` |
| BR-SW-03 | Phase 2: oldest WAITLISTED passenger promoted to CONFIRMED on trips with freed seats (FIFO) | `route.ts:189-194` |
| BR-SW-04 | Trip scanned if: `passengers: { some: { status: 'WAITLISTED' } }` | `route.ts:158-167` |
| BR-SW-05 | Capacity headroom = `capacity - count(CONFIRMED|BOARDED)` | `route.ts:182-185` |
| BR-SW-06 | Default target date: tomorrow (00:00 UTC) | `route.ts:67-72` |
| BR-SW-07 | Tenant scoping: `x-tenant-id` header preferred, `?tenantId=` query fallback, else platform-wide | `route.ts:62-65` |
| BR-SW-08 | `?dryRun=1` returns structured report without any write | `route.ts:113-118,259-269` |
| BR-SW-09 | Optional `CRON_SECRET` Bearer auth when no `x-tenant-id` | `route.ts:46-52` |

### 4.6 Headway service (`src/lib/headway/service.ts`)
| # | Rule | Source |
|---|---|---|
| BR-HW-01 | Day mask is 7 chars starting Sunday (`YYYYYYY`) | `service.ts:54-67` |
| BR-HW-02 | Window may cross midnight; engine splits into two sub-windows | `service.ts:11-13` |
| BR-HW-03 | Departure times: anchor (or startTime) + headwayMinutes until > endTime | `service.ts:13-15` |
| BR-HW-04 | Optional `tz?: string` (IANA zone) — engine uses `Intl.DateTimeFormat` to compute zone offset | `service.ts:80-100` |
| BR-HW-05 | Backwards-compat: omitting `tz` treats wall time as UTC | `service.ts:87-93` |

### 4.7 Finance bridge (`src/lib/bus-ops/finance-bridge.ts`)
| # | Rule | Source |
|---|---|---|
| BR-FIN-01 | Operating costs JE: debit `5145 Bus Operations Expense` / credit `2100 AP / Accrued` | `bridge.ts:8-13,125-126` |
| BR-FIN-02 | Revenue AR mirror: `4500 Bus Operations Revenue` (via `finance_invoices`) | `bridge.ts:10,159-182` |
| BR-FIN-03 | Cost centre / profit centre: `PC-BUS` | `bridge.ts:24` |
| BR-FIN-04 | Fuel expense keyed on `expense_no = 'FUEL-{fuelLogId}'` (idempotent) | `bridge.ts:209-217` |
| BR-FIN-05 | Revenue AR keyed on `(BUS_OPERATIONS, BUS_TRIP, scheduleId)` (idempotent) | `bridge.ts:161-164` |
| BR-FIN-06 | Default fuel rate `AED 3.50/L` (UAE diesel fallback) | `bridge.ts:22` |
| BR-FIN-07 | Default driver rate `AED 35.00/h` (UAE bus driver fallback) | `bridge.ts:23` |
| BR-FIN-08 | VAT rate 5% on fuel & revenue | `bridge.ts:25,154,175,207` |
| BR-FIN-09 | All three bridge functions are best-effort — errors caught + logged, never throw | `bridge.ts:130-133,187-189,246-248` |

### 4.8 CBA (Collective Bargaining Agreement) engine (`src/lib/cba/engine.ts`)
| # | Rule | Source |
|---|---|---|
| BR-CBA-01 | Only `enforced: true` rules constrain the algorithm | `engine.ts:29-33` |
| BR-CBA-02 | `cbaToWorkRules()` maps CBA categories → `WorkRules` fields | `engine.ts:35-46` |
| BR-CBA-03 | `cbaAudit()` returns status `ok / warn / violation` per rule | `engine.ts:78-93` |
| BR-CBA-04 | Warn threshold: within 10% of the cap | `engine.ts:81,98` |

### 4.9 Authentication & Session
| # | Rule | Source |
|---|---|---|
| BR-AUTH-01 | All `/api/bus-ops/*` require session (401 if absent) | `src/middleware.ts:81-88` |
| BR-AUTH-02 | All `/api/driver-app/*` (except public biometric flows) require session | `src/middleware.ts` + `src/lib/auth-route-policies.ts:68` |
| BR-AUTH-03 | Rate limit: 1,000 req/min per `${tenantId}:${pathname}` (per-tenant per-path) | `src/middleware.ts:23` |
| BR-AUTH-04 | Plan-based plan limits via `RateLimiter.getLimitForPlan(plan)` | `src/middleware.ts:104` |
| BR-AUTH-05 | Response includes `X-RateLimit-Limit / Remaining / Reset` and `X-API-Version` | `src/middleware.ts:160-164` |
| BR-AUTH-06 | `ENTERPRISE` data-residency header propagated | `src/middleware.ts:138-140` |

### 4.10 WebAuthn (driver biometric) — `src/app/api/driver-app/auth/biometric/*`
| # | Rule | Source |
|---|---|---|
| BR-WA-01 | `/register` requires session (401 without) | `register/route.ts` |
| BR-WA-02 | `/register/finish` validates response shape (401 on absent session) | `register/finish/route.ts` |
| BR-WA-03 | `/login/start` requires `username` (400 if missing) | `login/start/route.ts` |
| BR-WA-04 | `/login/start` returns 404 for unknown driver | `login/start/route.ts` |
| BR-WA-05 | `/login/start` returns 404 for driver with no credentials | `login/start/route.ts` |
| BR-WA-06 | `/login/finish` rejects malformed assertion (4xx) | `login/finish/route.ts` |

### 4.11 Outbox publisher
| # | Rule | Source |
|---|---|---|
| BR-OUT-01 | Each event routes to exactly one consumer (in-process registry) | `src/lib/outbox/registry.ts:7-11` |
| BR-OUT-02 | `register()` is idempotent (overwrites on re-registration) | `registry.ts:16-18` |
| BR-OUT-03 | `handle()` throwing → outbox row marked for retry | `types.ts:55-57` |
| BR-OUT-04 | `handle()` returning normally → inbox row recorded + row marked published | `types.ts:55-57` |
| BR-OUT-05 | Default `batchSize=50`, `maxRetries=10` | `types.ts:69-77` |

### 4.12 Module gating
| # | Rule | Source |
|---|---|---|
| BR-MOD-01 | `apiPathPrefixes: ['/api/bus-ops']` gates feature flag, CoA reverse-lookup, rate-limit plan | `src/lib/modules.ts:201` |

---

## 5. Workflows

### 5.1 Trip lifecycle workflow
```
SCHEDULED  →  DEPARTED  →  IN_TRANSIT  →  COMPLETED
       ↓           ↓              ↓
   CANCELLED   CANCELLED      CANCELLED
```
- Entry: `POST /api/bus-ops/schedule-templates/[id]/generate` (A-33) or `POST /api/bus-ops/schedules` (A-13)
- Transition: A-17 (`depart`), A-19 (`cancel`), A-18 (`complete`)
- On COMPLETED: emits `trip.completed` event (BR-FIN-01/02 mirror to finance)
- Auto-termination: `POST /api/cron/auto-close-trips` (C-01)

### 5.2 Waitlist sweep workflow (daily cron)
```
POST /api/cron/...              ┐
or POST /api/bus-ops/schedules/  │  caller
   sweep-waitlist               ┘
        │
        ▼
Phase 1: ABSENCE requests
  → flip CONFIRMED → ABSENT
  → mark request FULFILLED
        │
        ▼
Phase 2: WAITLIST auto-fill
  → FIFO promote WAITLISTED → CONFIRMED
  → send WhatsApp + email (best-effort)
        │
        ▼
Audit log: logAudit('UPDATE', TripPassenger, details)
```

### 5.3 Trip completion → finance mirror workflow
```
Trip COMPLETED (A-18)
   │
   ▼
trip.completed event written to event_outbox (DB-24)
   │
   ▼
POST /api/cron/outbox-publish (C-02) — publisher tick
   │
   ▼
Consumer: handleTripCompletedEvent (src/lib/finance/consumers/trip-completed-consumer.ts)
   ├── postTripOperatingCostsToFinance (BR-FIN-01)   → DRAFT JE
   └── mirrorBusTripRevenueToFinance   (BR-FIN-02)   → AR invoice
   │
   ▼
event_consumer_inbox row recorded (idempotency)
```

### 5.4 Fuel log → finance expense workflow
```
Driver app: POST /api/driver-app/fuel-entries (D-API-21)
   │
   ▼
fuel.fuelExpense event written
   │
   ▼
Consumer: handleFuelExpenseEvent (src/lib/finance/consumers/fuel-expense-consumer.ts)
   │
   ▼
postFuelLogToFinance (BR-FIN-04)
   │   INSERT into finance.finance_expenses
   │   ON CONFLICT skip (expense_no = 'FUEL-{fuelLogId}')
   ▼
DRAFT FinanceExpense
```

### 5.5 Bulk import workflow
```
POST /api/bus-ops/route-passengers/bulk-import (A-51)
   │
   ▼
?dryRun=true?            yes ──▶ Skip writes, return counts
   │  no
   ▼
?idempotencyKey present? yes ──▶ Cache hit → return cached (or 409 on body mismatch)
   │  no
   ▼
Per-row loop:
  → resolve employeeId → staff_id (tenant-scoped)
  → resolve routeCode / routeName → route_id
  → resolve stopName → stop_id
  → overlap check → skip if active dup
  → INSERT route_passenger
   │
   ▼
?idempotencyKey? yes ──▶ Cache result + bodyHash
   ▼
Response: { total, created, skipped, errored, errors }
```

### 5.6 BLE boarding workflow
```
BLE gateway POST /api/bus-ops/gateway/events (A-74)
   │
   ▼
HMAC-SHA256 verification (BR-BLE-01)
   │  401 if invalid
   ▼
Two ingest paths:
   ├── pre-processed: { kind, tagId, occurredAt }   → identity resolution
   └── raw scans:    { observations[] }              → detectTransitions()
                                                          (BR-BLE-04..08)
   │
   ▼
For each transition:
   → INSERT boarding_events (DB-19)
   → UPDATE trip_passengers.status (BR-PSG-03/04/05/07)
```

### 5.7 Headway → schedule generation workflow
```
Headway rule (routeId, dayMask, window, headway) ──┐
                                                    │  expandHeadway()
                                                    ▼
                                          List of departure times (HH:MM)
                                                    │
                                                    ▼
schedule-templates/[id]/generate (A-33) ──▶ Materialise concrete TripSchedules
                                                   per TransportCalendar exceptions
```

### 5.8 CBA-driven planning workflow
```
cba-rules (M-14) ──▶ CbaRuleSet (DB-12) ──▶ cbaToWorkRules() (BR-CBA-01..02)
                                                        │
                                                        ▼
                          plan/compute (A-90) ──▶ runcut + block + roster
                                                        │
                                                        ▼
                          cbaAudit() (BR-CBA-03..04) ──▶ compliance findings
                                                        │
                                                        ▼
                          plan/[id]/apply (A-92) ──▶ BusOpsScheduleTemplate instances
```

### 5.9 Geofence-driven boarding workflow
```
Driver app: POST /api/driver-app/trips/[id]/geofences (D-API-12)
   │
   ▼
Geofence enter/exit event
   │
   ▼
BoardingEventSource.GEOFENCE (EN-04)
   │
   ▼
Update TripPassenger.status
```

### 5.10 Driver self-service absence workflow
```
Staff portal: POST /api/bus-ops/transport-requests (A-61) with
              requestType='TEMPORARY', reason='ABSENCE …'
   │
   ▼
StaffTransportRequest (DB-17) PENDING
   │
   ▼
Next morning: POST /api/bus-ops/schedules/sweep-waitlist (A-27)
   │
   ▼
Phase 1 (BR-SW-01..02) flips CONFIRMED → ABSENT
   request → FULFILLED
```

---

## 6. Integrations

| # | Direction | External System | Mechanism | Code Surface |
|---|---|---|---|---|
| I-01 | Driver app → API | Capacitor Android shell | Native bridge (plugin auto-loaded) | `mobile-app/capacitor.config.ts`, `android/app/src/main/java/com/fleet360/driver/MainActivity.java` |
| I-02 | BLE → API | In-bus BLE gateway (RSSI scan batches + HMAC) | POST `/api/bus-ops/gateway/events` with HMAC-SHA256 signature | `bus-gateway.ts:31-44`, route A-74 |
| I-03 | QR scan → API | Driver-side QR scanner (driver app) | POST `/api/bus-ops/schedules/[id]/qr-token` (A-23) issues token, driver scans → `BoardingEvent.source='QR'` (EN-04) | A-23, EN-04 |
| I-04 | Biometric → API | WebAuthn platform authenticator (TouchID / FaceID / Android BiometricPrompt) | `navigator.credentials.create()` / `.get()` | D-API-01..05 |
| I-05 | Outbound | WhatsApp Business API | `sendWhatsApp()` (from `src/lib/whatsapp`) | A-27 (waitlist promotion), A-26 (notify) |
| I-06 | Outbound | SMTP email (SendGrid) | `sendEmail()` (from `src/lib/email`) | A-27, A-26 |
| I-07 | Outbound | Finance JE (draft) | `createDraftJournalEntry()` (from `@/lib/finance/journal-service`) | BR-FIN-01 |
| I-08 | Outbound | Finance AR invoice | `upsertFinanceInvoice()` (from `@/lib/finance/module-ledger`) | BR-FIN-02 |
| I-09 | Outbound | Finance expense | Direct INSERT into `finance.finance_expenses` | BR-FIN-04 |
| I-10 | Outbound | PDF manifest | `GET /api/bus-ops/schedules/[id]/manifest/pdf` (A-24) | A-24 |
| I-11 | Outbound | Power BI embed | `GET /bus-ops/powerbi` (M-38) | M-38 |
| I-12 | Outbound | Sentry error reporting | `captureException()` (from `@/lib/sentry`) | A-27, A-74, A-17/18/19 |
| I-13 | Outbound | Audit log | `logAudit()` (from `@/lib/audit`) | A-27 |
| I-14 | Inbound | Outbox publisher cron | `POST /api/cron/outbox-publish` (C-02) | C-02 |
| I-15 | Inbound | Auto-close trips cron | `POST /api/cron/auto-close-trips` (C-01) | C-01 |
| I-16 | API → Driver app | Feature flags | `GET /api/driver-app/feature-flags` (D-API-06) | D-API-06 |
| I-17 | API → Driver app | Continuous driving limit (CBA) | `GET /api/driver-app/cba/continuous-driving-limit` (D-API-23) | D-API-23 |
| I-18 | API → Driver app | Live geofences for current trip | `GET /api/driver-app/trips/[id]/geofences` (D-API-12) | D-API-12 |
| I-19 | Driver app → Backend | Heartbeat telemetry | `POST /api/driver-app/heartbeat` (D-API-07) | D-API-07 |
| I-20 | Driver app → Backend | Behavior events (harsh braking, speeding) | `POST /api/driver-app/behavior-events` (D-API-08) | D-API-08 |

---

## 7. User Journeys

### 7.1 Staff / passenger journey (end-to-end)
```
1. STAFF SELF-SERVICE ENROLMENT
   STAFF opens /bus-ops/passenger/app (M-28)
     → POST /api/bus-ops/transport-enrollments (A-65) — preferences
     → POST /api/bus-ops/transport-requests (A-61) for any change
        (e.g. stop change, temporary absence)

2. DAY-OF: SEES THEIR TRIP
   /bus-ops/passenger/today (M-30) → GET /api/bus-ops/passenger/today (A-45)
     → shows upcoming schedule, pickup time, driver

3. DAY-OF: ABSENCE REQUEST
   /bus-ops/passenger/absence (M-29) → POST /api/bus-ops/transport-requests (A-61)
     → StaffTransportRequest (DB-17) PENDING, requestType='TEMPORARY', reason='ABSENCE …'
     → Next-day sweep (5.2) flips them to ABSENT and frees the seat

4. BOARDING (BLE path — passive)
   BLE gateway (I-02) detects their tag
     → POST /api/bus-ops/gateway/events (A-74)
     → BR-BLE-04..08 presence detection
     → BoardingEvent inserted (DB-19)
     → TripPassenger.status CONFIRMED → BOARDED (BR-PSG-03)

5. ALIGHTING (BLE path)
   Tag unseen for grace period (BR-BLE-06)
     → ALIGHT transition (BR-BLE-08)
     → BoardingEvent inserted (DB-19)
     → TripPassenger.status BOARDED → ALIGHTED (BR-PSG-07)

6. BOARDING (QR fallback)
   /bus-ops/driver/trip/[id]/qr (M-20) → driver shows QR
   Driver scans with their app → token validation
     → BoardingEvent.source='QR' (EN-04)
     → TripPassenger.status updated
```

### 7.2 Driver journey (mobile app, end-to-end)
```
1. AUTH & ENROL BIOMETRIC
   /driver-app/enroll-biometric (D-13)
     → POST /api/driver-app/auth/biometric/register (D-API-01)
     → POST /api/driver-app/auth/biometric/register/finish (D-API-02)
   Subsequent logins:
     → POST /api/driver-app/auth/biometric/login/start (D-API-03)
     → POST /api/driver-app/auth/biometric/login/finish (D-API-04)
     → GET  /api/driver-app/auth/biometric/status (D-API-05)

2. PRE-SHIFT INSPECTION (DVIR)
   /driver-app/shift-checklist (D-04)
     → GET  /api/driver-app/shift/[id]/checklist (D-API-18)
     → POST /api/driver-app/dvir (D-API-20) — for each defect found
     → DvirDefect rows (DB-26)

3. SEE TODAY'S TRIPS
   /driver-app/today (D-02) → GET /api/driver-app/today/assignments (D-API-09)
     → shows TripSchedule list for today

4. START TRIP
   POST /api/driver-app/trips/[id]/start (D-API-10)
     → TripSchedule.status SCHEDULED → DEPARTED (BR-TRIP-01)
     → DriverShift created (DB-22)

5. DURING TRIP
   • Heartbeat ping every ~30s → POST /api/driver-app/heartbeat (D-API-07)
   • Behavior events (harsh braking etc) → POST /api/driver-app/behavior-events (D-API-08)
   • Geofence enter/exit → POST /api/driver-app/trips/[id]/geofences (D-API-12)
   • Continuous driving limit check → GET /api/driver-app/cba/continuous-driving-limit (D-API-23)
   • Navigation → /driver-app/navigate (D-15)

6. FUEL / EXPENSE
   • /driver-app/fuel-entry (D-08) → POST /api/driver-app/fuel-entries (D-API-21)
     → FuelLog row (DB-21) + outbox event → finance expense
   • /driver-app/expenses (D-09) → POST /api/driver-app/expenses (D-API-22)

7. END TRIP
   POST /api/driver-app/trips/[id]/end (D-API-11)
     → TripLog inserted (DB-14)
     → TripSchedule.status DEPARTED/IN_TRANSIT → COMPLETED (BR-TRIP-05/07)
     → trip.completed event emitted (5.3)
     → Finance bridge runs (BR-FIN-01/02)

8. SHIFT END
   POST /api/driver-app/shift/[id]/end (D-API-15)
     → DriverShift status → COMPLETED (DB-22)
     → /driver-app/shift-ended (D-05) summary screen
```

### 7.3 Admin / dispatcher journey (end-to-end)
```
1. SETUP A ROUTE
   /bus-ops/routes (M-06) → POST /api/bus-ops/routes (A-01)
   /bus-ops/route-planner (M-07) → POST /api/bus-ops/routes/[id]/stops (A-08)
     → BusRoute (DB-01) + RouteStop (DB-02)

2. CONFIGURE HEADWAY + CALENDAR
   /bus-ops/headway (M-08) → POST /api/bus-ops/headway (A-86)
   /bus-ops/transport-calendars (M-32) → POST /api/bus-ops/transport-calendars (A-34)
     → entries (A-39/40) for active dates / exceptions

3. CREATE A RECURRING SCHEDULE
   /bus-ops/schedule-templates (M-09) → POST /api/bus-ops/schedule-templates (A-28)
     → BusOpsScheduleTemplate (DB-05)

4. GENERATE CONCRETE TRIPS
   POST /api/bus-ops/schedule-templates/[id]/generate (A-33)
     → Materialises TripSchedules (DB-11) for a date window
       respecting the calendar

5. ASSIGN STAFF
   /bus-ops/staff (M-15) → POST /api/bus-ops/staff (A-52)
     → StaffMember (DB-15)
   Assign BLE/RFID tag:
     → POST /api/bus-ops/staff/[id]/ble-tag (A-56)
     → POST /api/bus-ops/staff/[id]/rfid-tag (A-57)
   Enrol staff to route (single):
     → POST /api/bus-ops/route-passengers (A-47)
   Bulk enrol (HR paste):
     → POST /api/bus-ops/route-passengers/bulk-import (A-51)
       with ?dryRun=true first, then ?idempotencyKey=<paste-token> on commit

6. DRIVER-SIDE: ASSIGN VEHICLE + DRIVER
   The generate step (A-33) maps each TripSchedule to a vehicle + driver.

7. PRE-TRIP CHECK
   /bus-ops/driver/trip/[id]/pretrip (M-21) → POST /api/bus-ops/schedules/[id]/pretrip-check (A-25)
     → BusPreTripCheck (DB-20) + DvirDefect[] (DB-26)

8. DISPATCH
   /bus-ops/dispatch (M-02) shows live status.
   Driver hits "Depart" → POST /api/bus-ops/schedules/[id]/depart (A-17)
     → TripSchedule.status SCHEDULED → DEPARTED (BR-TRIP-01)
     → All CONFIRMED passengers not at the bus get marked NO_SHOW (BR-PSG-05)
   Live GPS pings: BusGpsPing (DB-09) via /api/bus-ops/vehicles/[id]/location (A-68)
   Live map: /bus-ops/live-map (M-03)

9. BOARDING
   • BLE: A-74 (5.6) — automatic
   • QR: A-23 (token) + driver app scan
   • Manual: POST /api/bus-ops/passengers/[id] (A-44) status update via PATCH

10. COMPLETE / CANCEL
   POST /api/bus-ops/schedules/[id]/complete (A-18)
     → TripSchedule COMPLETED (BR-TRIP-05/07)
     → trip.completed event → finance bridge (5.3)
   Or POST /api/bus-ops/schedules/[id]/cancel (A-19)
     → TripSchedule CANCELLED (BR-TRIP-06/08/10)

11. INCIDENT REPORT
   /bus-ops/incidents (M-36) → POST /api/bus-ops/incidents (A-81)

12. ANALYTICS
   /bus-ops/analytics (M-37) → GET /api/bus-ops/analytics (A-95)
   /bus-ops/analytics/cost-breakdown (A-96)
   /bus-ops/analytics/demand-forecast (A-97)
   /bus-ops/powerbi (M-38) for BI embed
```

### 7.4 Cross-tenant data isolation journey
```
1. Tenant A admin logs in
   → x-tenant-id = A
   → query staffMembers → only Tenant A rows
   → query routePassengers → only Tenant A rows
   → request /api/bus-ops/schedules → only Tenant A schedules
2. Tenant B admin logs in
   → x-tenant-id = B
   → All queries scoped to B
3. The "platform cron" path (no x-tenant-id, valid CRON_SECRET)
   → Platform-wide scan; the route's `tenantScope` is null
   → Should be used by /api/cron/auto-close-trips (C-01) and outbox publish (C-02) only
   → For per-tenant sweep (A-27), pass ?tenantId=<uuid> as cron-path override
```

### 7.5 Idempotent retry journey
```
1. Operator pastes a 200-row CSV twice (paste-1, paste-2)
2. First POST:
   POST /api/bus-ops/route-passengers/bulk-import
   ?idempotencyKey=op-paste-2026-08-14-08h
   → 200/201, body: { total, created, skipped, errored, idempotencyKey }
3. Second POST (same key, same body):
   → 200/201, body: { ...same totals..., idempotencyReplay: true }
4. Third POST (same key, DIFFERENT body):
   → 409 { error: "idempotencyKey was already used with a different request body" }
5. 24h later (or after manual cleanup):
   → key expired → POST runs again
```

---

## 8. Test Coverage Map (existing tests in this repo)

| Test file | Status | Covers |
|---|---|---|
| `tests/unit/bus-ops-gateway-signature.test.ts` | **16/16 pass** | BR-BLE-01..03 |
| `tests/unit/bus-ops-trip-completed-consumer.test.ts` | **11/11 pass** | BR-FIN-01/02, workflow 5.3 (mirror logic) |
| `tests/integration/staff-transport-biometric.test.ts` | **8/8 pass** | BR-WA-01..06, D-API-01..05 |
| `tests/integration/staff-transport-bulk-import.test.ts` | **8/8 pass** | BR-IMP-01..14, A-51 |
| `tests/integration/staff-transport-waitlist-sweep.test.ts` | **1/1 pass · 3 skipped (dev-env)** | BR-SW-07, A-27 tenant scoping |
| `tests/integration/staff-transport-trip-lifecycle.test.ts` | exists (untracked state) | BR-TRIP-01..10 (likely) |
| `tests/integration/geofence-service.test.ts` | exists (untracked state) | Geofence geometry helpers |
| `tests/e2e/staff-transport-workflow.spec.ts` | exists (Playwright) | End-to-end admin journey |

**Coverage gap (this snapshot):**
- BR-TRIP-01..10: only at the unit level (state machine truth table); the route handlers (`depart/complete/cancel`) and the DB trigger (TR-01) are not directly asserted end-to-end.
- BR-PSG-01..09: only at the state machine unit level; route handlers + BoardingEvent ingestion not covered.
- BR-BLE-04..08 (`detectTransitions`): not unit-tested; this is a pure function and deserves truth-table coverage.
- BR-FIN-04..09 (fuel log + AR): not covered.
- Workflows 5.1, 5.2, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10: no end-to-end test yet.
- 7.4 (cross-tenant isolation): not covered.
- 7.5 (idempotent retry): partial — `bulk-import` covers the second-leg replay/conflict.

---

## 9. How to Use This Inventory

When planning a new test, find the entry here first:
- **A new unit test** → look in §4 (Business Rules) for the rule ID, then write a truth table in `tests/unit/`.
- **A new integration test** → look in §2 (APIs) for the route, then write a happy-path + 4xx/5xx scenario in `tests/integration/`.
- **A new E2E test** → look in §7 (User Journeys), pick the journey, and assert every step.
- **A new workflow test** → look in §5 (Workflows), exercise the trigger → effect chain.

Every entry above maps to a real file in the codebase. If something listed here no longer exists, the test that depended on it should be deleted or rewritten.
