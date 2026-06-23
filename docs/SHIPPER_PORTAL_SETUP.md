# Shipper Portal — Setup & Operations Guide

The Shipper Portal lets a tenant's **customers (shippers)** log in to a
self-service surface to:

- Submit shipment requests (pickup, delivery, cargo, windows)
- Track their shipments with operator-controlled visibility
- See status updates in real time

Shipper portal users are a **separate identity domain** from tenant
operators — they can never act as operators and vice versa. They authenticate
with their own cookie (`shipper-portal-session`) and are strictly scoped to a
single customer record.

---

## 1. Environment variables

Add to `.env` (and `.env.example`):

```bash
# Signs shipper-portal session cookies (HMAC-SHA256).
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SHIPPER_PORTAL_SESSION_SECRET=<64-hex-char-secret>

# Base URL used to build invitation setup links.
NEXT_PUBLIC_APP_URL=https://your-deployment.example.com
```

If `SHIPPER_PORTAL_SESSION_SECRET` is unset, the code falls back to
`SESSION_SECRET` / `AUTH_SECRET`, and finally an **insecure dev fallback**
(logged loudly). Set a real secret before production.

Invitation emails are sent through the tenant's existing `IntegrationConfig`
row of `type='EMAIL'` (the same SMTP config the workflow engine uses). No
separate email setup is required — if SMTP isn't configured, the invitation
is still created and the operator gets the setup link to share manually.

---

## 2. Database

All tables are created lazily on first request (the
`ensureShipperPortalTables()` pattern) — **no Prisma migration needed**.

New tables:
- `customer_portal_users` — portal identities (one customer can have many)
- `customer_portal_invitations` — single-use, 7-day setup tokens

Columns added to existing tables:
- `customers.portal_tracking_level` — per-customer default visibility
- `logistics_shipment_orders.portal_tracking_level` — per-shipment override
- `logistics_shipment_orders.portal_tracking_override_reason` — audit text
- `logistics_shipment_orders.source_channel` — `'SHIPPER_PORTAL'` tag
- `tenant_settings.default_portal_tracking_level` — tenant default

---

## 3. Tracking-visibility levels

Four levels control what a shipper sees about a shipment. They form a strict
hierarchy — each level is a superset of the one below.

| Level | What the shipper sees |
|---|---|
| **NONE** | Only terminal events (submitted, acknowledged, delivered). No status timeline, no ETA, no carrier identity. |
| **STATUS_ONLY** | Full status timeline, origin & destination, cargo summary, expected cost. No ETA, no live GPS, no carrier name. |
| **STATUS_AND_ETA** | Above + estimated delivery + planned route. Still no live GPS or carrier identity. |
| **FULL_TRACKING** | Above + live GPS location + driver name & phone + vehicle plate + carrier name. |

### Resolution order (most specific wins)

```
1. logistics_shipment_orders.portal_tracking_level   (per-shipment override)
2. customers.portal_tracking_level                    (per-customer default)
3. tenant_settings.default_portal_tracking_level      (tenant default)
4. Hard fallback: STATUS_ONLY
```

The server resolves the effective level and **filters the shipment payload
before it ever leaves the API** (`filterShipmentForTracking`). Fields above
the permitted level are never sent to the client — they can't be revealed by
inspecting network traffic.

### Setting levels

| Scope | Where |
|---|---|
| Tenant default | `/admin/shipper-portal-config` → "Tenant default" card → Change |
| Per customer | `/admin/shipper-portal-config` → customer row → Visibility |
| Per shipment | Operator shipment detail page → `TrackingVisibilityModal` (override, with "Clear override" to revert to inherited) |

Downgrades (reducing visibility) prompt for a reason; the reason is stored on
the shipment and written to the audit log. Every change is audit-logged with
a previous → new diff.

---

## 4. Onboarding a shipper (operator workflow)

1. Open `/admin/shipper-portal-config`.
2. Find the customer in the table → click **Invite**.
3. Enter the shipper's email (and optional name) → **Send invitation**.
4. If SMTP is configured, the shipper receives a setup link by email.
   Otherwise, copy the displayed setup URL and share it manually.
5. The shipper opens the link → `/shipper-portal/setup?token=…` → sets a
   password → lands on the dashboard.

Invitations are single-use and expire after 7 days. Re-inviting generates a
fresh token (old pending tokens remain valid until used or expired).

---

## 5. The shipper experience

| Page | URL | Purpose |
|---|---|---|
| Login | `/shipper-portal/login` | Email + password |
| Setup | `/shipper-portal/setup?token=…` | First-time password set |
| Dashboard | `/shipper-portal` | Welcome, stats, recent shipments |
| Shipments | `/shipper-portal/shipments` | List, filter, search |
| New shipment | `/shipper-portal/shipments/new` | Pickup / Delivery / Cargo form |
| Shipment detail | `/shipper-portal/shipments/[id]` | Status timeline + visibility-gated tracking |

A shipment submitted from the portal:
- Is created with `status='PENDING'` (skips DRAFT — the shipper has signed off)
- Is tagged `source_channel='SHIPPER_PORTAL'`
- Carries `metadata.submittedByPortalUserId` for traceability
- Appears immediately in the operator's `/logistics/dispatch`

The operator then acknowledges, assigns a carrier (via the existing
marketplace / RFQ flow — RFQ stays operator-side), and dispatches. The
shipper sees status changes on their detail page, which polls every 30 s.

---

## 6. Security model

- **Separate auth domain** — portal users live in `customer_portal_users`,
  never in `User` / `UserTenant`.
- **Path-scoped enforcement** — every `/api/shipper-portal/*` route calls
  `requireShipperPortal()`, which validates the cookie, hydrates the user,
  and checks `is_active`. A deactivated user's next request returns 403.
- **Customer scoping** — a portal user can only ever read/write shipments
  where `cargo_owner_customer_id` equals their own customer id. Cross-customer
  reads return **404** (not 403) so a hostile user can't probe for shipment IDs.
- **Tokens** — invitation tokens are stored as SHA-256 hashes; the raw token
  exists only in the email link. A DB leak can't be used to forge setups.
- **Passwords** — PBKDF2 (100k iterations, SHA-512), the same scheme as
  tenant operator auth.

---

## 7. Deactivating a portal user

Operators can deactivate a portal user (e.g. they left the customer's company)
via `setPortalUserActive(tenantId, userId, false)` — exposed through the
portal-users store. A deactivated user's valid cookie stops working on the
next request (the `is_active` check in `requireShipperPortal`).

---

## 8. What's NOT in this phase

- Customer self-service signup (invitation-only for now)
- Multi-customer portal users (one user = one customer)
- Invoice viewing / payment (Phase 2)
- Email / PDF / WhatsApp intake channels (deferred — portal-first was chosen
  as the cheaper, higher-quality, compliance-friendly starting point)
- Shipper-side RFQ visibility (RFQ stays operator-mediated by design)

---

## 9. Quick test (local)

```bash
# 1. Ensure your tenant has at least one Customer record.
# 2. As an operator, invite a portal user:
curl -X POST http://localhost:3000/api/admin/customers/<CUSTOMER_ID>/portal-invitations \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <TENANT_ID>" -H "x-user-id: <OP_USER_ID>" \
  -d '{"email":"test@example.com","fullName":"Test Shipper"}'
# → response includes invitation.setupUrl

# 3. Open the setupUrl in an incognito window, set a password.
# 4. Submit a shipment via the form.
# 5. Confirm it appears in /logistics/dispatch with source_channel=SHIPPER_PORTAL.

# 6. Flip a tracking level and watch the detail page change:
#    UPDATE customers SET portal_tracking_level='FULL_TRACKING' WHERE id='<CUSTOMER_ID>';
```
