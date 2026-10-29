# Authorization matrix

Generated from `src/lib/authz/policy-matrix.ts` and `SYSTEM_ROLES` by `tests/unit/authz-policy-matrix.test.ts`.
Do not edit by hand: run `UPDATE_AUTHZ_MATRIX=1 npx vitest run tests/unit/authz-policy-matrix.test.ts`.

- Policy version: `2026-10-13.1`
- Permission catalogue version: `0ac7ad93` (254 permissions)

## API areas

| Area (`/api/…`) | Routes | Reads (GET) | Writes (POST/PUT/PATCH/DELETE) |
|---|---:|---|---|
| `admin` | 102 | ADMIN_ROUTE_POLICY | ADMIN_ROUTE_POLICY |
| `agents` | 11 | module `agents` | module `agents` |
| `agents/anomalies` | 1 | module `finance` | module `finance` |
| `agents/preventive-maintenance` | 3 | module `maintenance` | module `maintenance` |
| `agents/route-results` | 2 | module `school-bus` | module `school-bus` |
| `alert-configs` | 2 | tenant-admin | tenant-admin |
| `alerts` | 3 | self | self |
| `alerts/configs` | 0 | tenant-admin | tenant-admin |
| `ambulance` | 2 | module `incidents` | module `incidents` |
| `approval-link` | 1 | external | external |
| `assets` | 33 | module `assets` | module `assets` |
| `assets/ble/ingest` | 1 | external | external |
| `auth` | 16 | self | self |
| `billing` | 2 | tenant-admin | tenant-admin |
| `booking-portal` | 4 | module `booking-portal` | module `booking-portal` |
| `bookings` | 2 | module `booking-portal` | module `booking-portal` |
| `branch-staff` | 1 | self | self |
| `branding` | 1 | external | external |
| `bus-ops` | 112 | module `bus-ops` | module `bus-ops` |
| `bus-ops/gateway` | 1 | external | external |
| `carrier-portal` | 8 | external | external |
| `chat` | 1 | self | self |
| `compliance` | 7 | module `compliance` | module `compliance` |
| `cron` | 2 | external | external |
| `customer` | 3 | self | self |
| `customer-hierarchy` | 2 | module `customer-mgmt` | module `customer-mgmt` |
| `customers` | 4 | module `customer-mgmt` | module `customer-mgmt` |
| `debug` | 1 | platform | platform |
| `dispatch` | 12 | module `dispatch` | module `dispatch` |
| `dispatch/ambulance-calls` | 0 | module `incidents` | module `incidents` |
| `dispatcher` | 2 | module `dispatch` | module `dispatch` |
| `documents` | 8 | module `compliance` | module `compliance` |
| `documents/intelligence/cron` | 1 | external | external |
| `driver-app` | 30 | external | external |
| `drivers` | 9 | module `driver-mgmt` | module `driver-mgmt` |
| `esign` | 3 | module `leasing` | module `leasing` |
| `exchange` | 17 | partner | partner |
| `files` | 1 | self | self |
| `finance` | 47 | module `finance` | module `finance` |
| `fleet` | 36 | module `fleet` | module `fleet` |
| `garages` | 2 | module `maintenance` | module `maintenance` |
| `health` | 2 | external | external |
| `incidents` | 3 | module `incidents` | module `incidents` |
| `integration-configs` | 1 | tenant-admin | tenant-admin |
| `integrations` | 2 | tenant-admin | tenant-admin |
| `integrations/enterprise/webhook` | 1 | external | external |
| `jobs` | 1 | external | external |
| `kyc` | 2 | module `customer-mgmt` | module `customer-mgmt` |
| `leasing` | 91 | module `leasing` | module `leasing` |
| `leasing-portal` | 13 | external | external |
| `leasing/documents/upload` | 1 | module `leasing` | self |
| `logistics` | 64 | module `logistics` | module `logistics` |
| `logistics/rates/quote` | 0 | self | self |
| `maintenance` | 23 | module `maintenance` | module `maintenance` |
| `maintenance-requests` | 3 | module `maintenance` | module `maintenance` |
| `mobile` | 1 | external | external |
| `my-approvals` | 2 | self | self |
| `notifications` | 3 | self | self |
| `operations` | 2 | self | self |
| `places` | 2 | self | module `dispatch` |
| `platform` | 1 | external | external |
| `powerbi` | 1 | module `reports` | module `reports` |
| `public` | 8 | external | external |
| `push` | 3 | self | self |
| `push/run-scheduler` | 1 | external | external |
| `quotations` | 2 | module `booking-portal` | module `booking-portal` |
| `readyz` | 1 | external | external |
| `realtime` | 1 | self | self |
| `rental` | 53 | module `rental` | module `rental` |
| `reports` | 5 | module `reports` | module `reports` |
| `route-optimizer` | 2 | module `bus-ops` | module `bus-ops` |
| `school-bus` | 35 | module `school-bus` | module `school-bus` |
| `search` | 1 | self | self |
| `service` | 0 | module `maintenance` | module `maintenance` |
| `service-requests` | 2 | module `service-tickets` | module `service-tickets` |
| `service-tickets` | 14 | module `service-tickets` | module `service-tickets` |
| `setup` | 1 | external | external |
| `shipper-portal` | 9 | external | external |
| `stripe` | 1 | external | external |
| `sustainability` | 3 | module `sustainability` | module `sustainability` |
| `telematics` | 5 | module `fleet` | module `fleet` |
| `tenant` | 1 | self | tenant-admin |
| `tenant-branches` | 1 | self | tenant-admin |
| `tenant-subscriptions` | 1 | tenant-admin | tenant-admin |
| `tenants` | 3 | external | external |
| `track` | 1 | external | external |
| `users` | 2 | self | tenant-admin |
| `vehicles` | 3 | module `fleet` | module `fleet` |
| `version` | 1 | external | external |
| `webhooks` | 2 | external | external |
| `whatsapp` | 4 | tenant-admin | tenant-admin |
| `work-orders` | 1 | module `maintenance` | module `maintenance` |
| `workflow` | 1 | tenant-admin | tenant-admin |
| `workflow/trigger` | 1 | tenant-admin | self |

## System roles × modules

V view · C create · E edit · D delete · A approve · X export · `*` all resources, `r` some resources only.

| Role | admin | agents | ai-platform | assets | booking-portal | bus-ops | compliance | customer | customer-mgmt | dispatch | drayage | driver-mgmt | finance | fleet | incidents | leasing | logistics | maintenance | mobile-apps | rental | reports | school-bus | service-tickets | sustainability | vendors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all |
| TENANT_ADMIN | — | V C E D A X | V C E D A X | V C E D A X | V C E D A X | V Cr Er Dr Ar X Mr | V C A X | V C E D A X | V C E D A X | V C E D A X | V C E D A X | V Cr Er Dr X | V Cr E D Ar X | V Cr Er Dr X | V C E D A X | V Cr Er Dr Ar X | V C E D A X | V Cr Er Ar X | V C E D A X | V Cr Er Dr Ar X | V C X | V C E D A X | V C E D A X | V C E D A X | V C E D A X |
| LEASING_MANAGER | — | — | — | — | — | — | — | — | — | — | — | — | V | — | — | V Cr Er Dr Ar X | — | — | — | — | V C X | — | — | — | — |
| LEASING_OPERATOR | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | V Cr Er | — | — | — | — | — | — | — | — | — |
| RAC_MANAGER | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | V Cr Er Dr Ar X | V | — | — | — | — |
| RAC_OPERATOR | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | V Cr Er | — | — | — | — | — |
| TRANSPORT_MANAGER | — | — | — | — | — | V Cr Er Dr Ar X Mr | — | — | — | V C E D A X | — | V | — | V | — | — | — | — | — | — | V | V C E D A X | — | — | — |
| TRANSPORT_OPERATOR | — | — | — | — | — | V Cr Er Ar Mr | — | — | — | V C E A | — | V | — | V | — | — | — | — | — | — | — | V C E A | — | — | — |
| FLEET_MANAGER | — | — | — | V C E D A X | — | — | V C | — | — | — | — | V Cr Er Dr X | — | V Cr Er Dr X | — | — | — | V Cr Er Ar X | — | — | V C X | — | — | — | — |
| FINANCE_MANAGER | V | V | V | V | V | V | V | V | V | V | V | V | V Cr E D Ar X | V | V | V Cr Dr Ar X | V | V | V | V | V C X | V | V | V | V |
| VIEWER | Vr | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V | V |
| PARTNER | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
