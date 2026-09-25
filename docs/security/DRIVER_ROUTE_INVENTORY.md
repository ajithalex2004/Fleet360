# Driver entry points: authorization inventory

Every route a driver, driver device or partner-driver link can call, and how each one establishes **who** is calling, **which tenant**, and **which record** it may act on.

`/api/driver-app/*` is a public prefix: middleware does not require a session there, because the biometric and device login flows run before one exists. When a request carries a valid driver or staff session cookie, middleware forwards that session's verified identity. It never forwards client-sent identity headers. Each route must therefore authenticate and authorize on its own.

**Standard for a driver write:**
1. `requireAuthorizedTenant` confirms the tenant from the middleware-verified identity.
2. `requireDriverSessionForTenant` confirms the session cookie is valid, not expired, not revoked, and for that tenant.
3. `requireActiveDriver` confirms a `drivers` row exists for that user in that tenant, not deleted, with status ACTIVE or unset. An office user's session is refused.
4. Every shift, trip and vehicle the request names must be the driver's own, checked by `authorizeDriverReferences` or by a query filtered on tenant and driver. Identifiers in the body never choose the target on their own.

All four live in `src/lib/driver-session.ts` and `src/lib/driver-app-actor.ts`.

## `/api/driver-app/*`

| Route | Method | Caller proof | Record authorization | Tests |
|---|---|---|---|---|
| `emergency-sos` | POST | driver session for tenant + active driver | driver, vehicle and trip taken from the driver's own records; body identifiers ignored | `driver-app-actor.test.ts` |
| `telematics/live-location` | POST | same | stored only for the driver's in-progress trip vehicle; body identifiers that disagree → 403 | same |
| `nrm-toggle` | POST | same | vehicle of the driver's trip or shift; foreign identifiers → 403 | same |
| `fuel-entries` | POST | driver session for tenant + **active driver** | **shiftId, tripId and vehicleId must be the driver's own** (`authorizeDriverReferences`) | `driver-app-references.test.ts` |
| `fuel-entries` | GET | driver session | rows filtered by tenant + driver | — |
| `expenses` | POST | driver session for tenant + **active driver** | **shiftId** and tripId must be the driver's own | `driver-app-references.test.ts` |
| `expenses` | GET | driver session | filtered by tenant + driver | — |
| `reports` | POST | driver session for tenant + **active driver** | **tripId and shiftId must be the driver's own**; previously the trip was looked up by tenant only, so another driver's trip and vehicle could be attached to a service ticket | `driver-app-references.test.ts` |
| `reports` | GET | driver session | filtered by tenant + driver | — |
| `reports/[id]` | GET | driver session | report filtered by tenant + driver | — |
| `reports/[id]/cancel` | POST | driver session for tenant + **active driver** | report filtered by tenant + driver | `driver-app-references.test.ts` |
| `behavior-events` | POST | driver session for tenant + **active driver** | **every event's shiftId and tripId must be the driver's own** | `driver-app-references.test.ts` |
| `behavior-events` | GET | driver session | filtered by tenant + driver (+ trip) | — |
| `shift/current` | POST | driver session for tenant + **active driver** | **vehicleId must be assigned to the driver, or on their active shift or scheduled/in-progress trip**; the shift itself is created for the session driver | `driver-app-references.test.ts` |
| `shift/current` | GET | driver session | filtered by tenant + driver | — |
| `shift/[id]/end` | POST | driver session for tenant + **active driver** | shift filtered by id + tenant + driver | `driver-app-references.test.ts` |
| `shift/[id]/checklist` | POST | driver session for tenant + **active driver** | shift filtered by id + tenant + driver, must be ACTIVE | same |
| `shift/[id]`, `shift/[id]/recent-entries`, `shift/history` | GET | driver session | filtered by tenant + driver | — |
| `trips/[id]/start` | POST | driver session for tenant + **active driver** | trip in tenant, `driver_id` = session driver, valid state transition | `driver-app-references.test.ts` |
| `trips/[id]/end` | POST | same | same | same |
| `trips/[id]/geofences`, `trips/history`, `today/assignments` | GET | driver session | trip in tenant assigned to the session driver | — |
| `dvir` | POST | middleware-verified identity, session tenant = route tenant, + **active driver** | body driverId must equal the session driver; trip must be in the tenant and assigned to the driver; vehicle taken from the trip | — |
| `cba/continuous-driving-limit`, `feature-flags` | GET | driver session | tenant-level settings only | — |
| `heartbeat` | POST | carrier **device token**; **the device's tenant must equal the session's tenant** | presence stored for the token's carrier device | Not functional yet: `resolveCarrierAppDevice` is an unimplemented stub, so every call returns 500 |
| `auth/biometric/*` | POST/GET | WebAuthn challenge and assertion | login and registration flow; issues the driver session | Not reviewed in this change |

## Driver entry points outside `/api/driver-app`

| Route | Caller proof | Status |
|---|---|---|
| `/api/public/partner-driver/[token]` (GET, POST) and `…/telemetry`, `…/telemetry-batch`, `…/waypoint` | Per-trip link token: its hash is looked up, and revocation and expiry are checked on every read and write | Tenant and trip come from the token's assignment. **Follow-up:** these queries run without a tenant RLS context; the entry-point standardisation step should give them one |
| `/api/logistics/driver-handover/update-status` (POST) | Staff session | Stub: echoes the request and writes nothing. **Follow-up:** remove it or implement it with driver and trip authorization |
| `/api/school-bus/driver/today?driverCode=…` (GET) | Any session of the tenant | Read-only and tenant-scoped, but **the driver is chosen by the `driverCode` query parameter**, not the signed-in driver. Any user of the tenant can read another driver's school-bus trips, including student details. School-bus trips store the driver as free text (no foreign key). **Follow-up:** bind the trips to a driver id and derive it from the session |

## Behaviour change to note

Office users can no longer use the driver-app write routes with their staff session. The driver-session helpers accept the staff cookie for a demo flow, and until now any signed-in user could file fuel entries, expenses and reports, start and end trips and shifts, or raise events as if they were a driver. Demo accounts need a `drivers` row with status ACTIVE (the same rule SOS, live location and NRM have enforced since PR #94).
