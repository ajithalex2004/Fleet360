# Admin Module Test Matrix

This matrix defines the granular coverage required before an Admin change is considered verified.

## Global Rules

Every Admin API route and UI workflow must be tested against these dimensions:

| Dimension | Required checks |
| --- | --- |
| Authentication | no session returns 401; expired/revoked session is denied |
| Authorization | Super Admin, Tenant Admin, and unsupported role behavior is explicit |
| Tenant boundary | Tenant Admin can only access own tenant data; arbitrary tenantId params are denied |
| Approval workflow | dangerous mutations return 428 until approved |
| Audit/change history | every mutation records actor, tenant, before/after summary, and impersonation context when present |
| Data consistency | overview totals equal list/detail rows; orphan foreign keys are rejected or surfaced |
| UI state | loading, empty, error, and success states are visible and do not silently hide backend failures |

## Menu Coverage

| Menu | API coverage | UI coverage | Data invariants |
| --- | --- | --- | --- |
| Overview | `/api/admin/session`, tenants/users/roles/permissions source APIs | cards render, loading/error states, tenant scope, quick links | displayed counts match source APIs |
| Users | `/api/admin/users`, `/api/admin/users/[id]`, bulk, invitations | create, edit, deactivate/delete, filters, module access | active filter excludes deleted users; tenant roles persist after reload |
| Roles & Permissions | roles CRUD, permissions, versions, compare, clone | clone, compare, edit permissions, rollback/history | system roles canonical names; role code unique per tenant |
| Tenants | tenants CRUD, modules, settings, SSO, API keys | create tenant, module toggles, SSO/API key dangerous actions | module keys canonical; Tenant Admin cannot manage another tenant |
| Branches & Regions | `/api/tenant-branches` | create, edit, delete, filters, loading/error states | tenant-admin scope enforced; branch mutations produce audit/change-history |
| Workflows | workflow definition/step APIs | workflow list/detail, step editor, clone/delete approval feedback | dangerous workflow mutations are approval-gated and traceable |
| Billing & Subscriptions | `/api/billing`, `/api/tenant-subscriptions`, canonical billing | overview, subscription list, create/update/cancel, billing run preview | active subscription count equals subscription rows; subscription tenant_id exists in tenants; MRR equals active rows |
| Service Configuration | types, categories, scopes, rules, workflow, health | create/edit type, mapping, rule history, reset override | configured modules come from canonical module/data masters; invalid mappings blocked |
| Admin Approvals | approval queue APIs | multi-actor queue, approve/reject, retry dangerous action | required approvals count enforced; requester cannot self-approve when policy forbids |
| Audit Log | audit/change-history APIs | filters, export, audit detail drawer, change-history before/after drawer | all Admin mutations produce audit rows and masked before/after records |
| Security | sessions, MFA policy, revocation | MFA policy edit, session list, revoke | active session count/list consistent; revoked sessions denied |
| Settings / Notifications / Integrations | platform settings, notification channels, integration configs | edit/save/test channel | secrets masked; test failures visible |

## Regression Invariants

These are mandatory automated checks:

| Invariant | Reason |
| --- | --- |
| Billing overview active count equals `/api/tenant-subscriptions` active rows | Prevents overview/list mismatch |
| No `tenant_module_subscriptions.tenant_id` orphan rows | Prevents blank tenant names and wrong billing ownership |
| Role aliases normalize to canonical role labels | Prevents `Tenant Admin` vs `Tenant Administrator` drift |
| Tenant Admin cross-tenant requests return 403 | Prevents tenant boundary bypass |
| Dangerous Admin mutations return approval required | Prevents immediate destructive actions |
| All Admin mutation responses produce audit/change-history rows | Prevents invisible changes |

## Automated Slice Coverage

| Slice | Test file | Coverage |
| --- | --- | --- |
| Billing invariants | `tests/integration/admin-billing-invariants.test.ts` | active subscription counts, orphan subscription rows, MRR consistency |
| Billing UI | `tests/e2e/admin-billing.spec.ts` | overview/list subscription consistency, populated subscriptions tab, in-app subscription cancellation confirmation, approval queue for dangerous billing changes |
| Users/access control | `tests/integration/admin-users-access.test.ts` | role labels, tenant assignment persistence, active/deleted filtering |
| Users UI | `tests/e2e/admin-users.spec.ts` | pending invitation visibility, module access save/reload, create user with role assignment, import users, assign modal, delete confirmation, bulk deactivate confirmation, inactive/deleted filtering |
| Tenant modules | `tests/integration/admin-tenant-modules.test.ts` | module save/reload, invalid module keys, tenant boundary |
| Tenants UI | `tests/e2e/admin-tenants.spec.ts` | create tenant wizard, canonical module chips, tenant detail module state, module update approval queue, status change approval queue |
| Service Configuration linkage | `tests/integration/admin-service-config-linkage.test.ts` | module mapping aliases, rule history, approval retry |
| Audit/change history API | `tests/integration/admin-audit-change-history.test.ts` | mutation before/after records, impersonation context, filtering, pagination metadata, tenant boundary, secret masking |
| Audit/change history UI | `tests/e2e/admin-audit-history.spec.ts` | audit row detail drawer, change-history tab, before/after drawer, impersonation marker, masked secrets |
| Admin Approvals workflow | `tests/integration/admin-approvals-workflow.test.ts` | two-person approval, self-approval denial, tenant-scoped voting, rejection closure, lifecycle history |
| Admin Security API | `tests/integration/admin-security.test.ts` | tenant-scoped sessions, two-approver session revoke, revoked session denial in `/api/auth/me`, MFA policy approval/save/reload/login enforcement, failed-login lockout visibility, audit/change-history for security mutations |
| Admin Security UI | `tests/e2e/admin-security.spec.ts` | security dashboard renders MFA posture, recent session evidence, failed-login evidence, and account-lockout review |
| Roles & Permissions API | `tests/integration/admin-roles-permissions.test.ts` | clone system role to tenant role, compare permission deltas, preview affected users, immutable versions, two-approver rollback, tenant-boundary denial |
| Roles & Permissions UI | `tests/e2e/admin-roles.spec.ts` | roles page loads, clone action succeeds, create role, compare roles, save permission edits, preview affected users, role history visibility, rollback approval queue, dangerous delete uses in-app confirmation modal |
| Settings / Notifications / Integrations API | `tests/integration/admin-settings-integrations.test.ts` | auth required, platform secret masking, approval queue for platform changes, integration secret masking, integration approval gating |
| Settings / Notifications / Integrations UI | `tests/e2e/admin-settings.spec.ts` | platform settings approval feedback, reset confirmation modal, notification test failure visibility, integration approval queue feedback |
| Overview UI | `tests/e2e/admin-overview.spec.ts` | tenant-scoped source API count parity, hidden dangerous seed action for tenant admins, quick link navigation, visible source API failure state |
| Branches & Regions UI | `tests/e2e/admin-branches.spec.ts` | tenant-admin branch create/edit/save-reload/delete, cross-tenant API denial, visible API failure state, audit/change-history evidence |
| Workflows UI/API | `tests/e2e/admin-workflows.spec.ts` | workflow detail and step visibility, step/create clone/delete approval feedback, approved update retry execution, change-history evidence |
