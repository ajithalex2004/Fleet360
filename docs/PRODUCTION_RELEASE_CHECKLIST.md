# Fleet360 Production Release Checklist

Use this checklist for every production promotion. Required items must be green
before release; warnings need an explicit owner and acceptance note.

## 1. Environment

- [ ] `npm run check:prod` passes required checks.
- [ ] `DATABASE_URL` points to the Neon pooled production branch.
- [ ] `FLEET360_ENABLE_LOCAL_MIRROR` is false or unset.
- [ ] `SESSION_SECRET` is set and at least 32 characters.
- [ ] `SSO_ENCRYPTION_KEY` is set and at least 32 characters.
- [ ] `NEXT_PUBLIC_APP_URL` points to the production origin.
- [ ] Stripe configured or billing checkout/portal warning accepted.
- [ ] Email configured or invitation/notification warning accepted.
- [ ] Sentry configured or telemetry warning accepted.

## 2. Database

- [ ] `npm run check:deploy` passes.
- [ ] `npx prisma migrate status` shows no drift or unapplied migrations.
- [ ] New migrations were applied to staging/preview first.
- [ ] Backfill scripts are idempotent and have row-count verification.
- [ ] Neon PITR/backup policy confirmed for the target branch.
- [ ] `NEON_BACKUP_POLICY_CONFIRMED=true` set only after confirmation.
- [ ] Restore drill date recorded in release notes if this is a monthly release.

## 3. Application Smoke

- [ ] `/api/health` returns `status=ok`.
- [ ] Admin login succeeds.
- [ ] Tenant 360 page opens for an active tenant.
- [ ] Users page loads and filters correctly.
- [ ] Roles page loads and permission view is readable.
- [ ] Billing overview/subscriptions reconcile for at least one tenant.
- [ ] Admin Approvals queue opens and pending approval count matches Tenant 360.
- [ ] Audit/change history opens with recent entries.

## 4. Monitoring And Alerts

- [ ] External uptime monitor checks `/api/health` every 1-5 minutes.
- [ ] `UPTIME_MONITOR_URL` is recorded.
- [ ] Alert recipient and escalation path are current.
- [ ] Sentry project/environment configured when telemetry is enabled.
- [ ] Neon status/metrics access is available to the operator.

## 5. Rollback

- [ ] Last known good commit/tag identified.
- [ ] Rollback approach written in release notes.
- [ ] For schema changes, forward-fix migration plan is preferred and documented.
- [ ] Credential rotation plan ready if secrets were touched.

## 6. Release Notes

- [ ] User-visible changes listed.
- [ ] Admin-control-plane changes listed.
- [ ] Warnings accepted with owner/date.
- [ ] Migration and backup verification summarized.
- [ ] Post-release watch window assigned.
