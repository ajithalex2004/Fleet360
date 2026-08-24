# RLS Migration - Deployment Guide

**Target Platform:** Vercel (Next.js)  
**Deployment Type:** Staging → Production  
**Date:** 2026-08-23

---

## Pre-Deployment Validation ✅

All checks must pass before deployment:

```bash
# 1. RLS Compliance Check
node scripts/check-tenant-rls.js
# Expected: 0 violations ✅

# 2. Smoke Tests
node scripts/rls-smoke-test.js
# Expected: 5/5 tests passing ✅

# 3. TypeScript Compilation
npm run typecheck
# Expected: No errors

# 4. Build Verification
npm run build
# Expected: Successful build
```

---

## Deployment Architecture

### Current Setup
- **Platform:** Vercel (detected via `vercel.json`)
- **Framework:** Next.js (App Router)
- **Database:** PostgreSQL (direct connection required for RLS)
- **Cron Jobs:** 14 scheduled jobs configured

### RLS Requirements
⚠️ **CRITICAL:** Database connection must be direct (not connection pooler)

```
❌ Wrong: postgres://...@pooler.region.neon.tech
✅ Right: postgres://...@region.neon.tech
```

RLS policies use `set_config()` which requires session-level settings that don't work with connection poolers.

---

## Environment Variables Checklist

### Required for RLS
```bash
# Database - MUST be direct connection
DATABASE_URL=postgres://user:pass@host:5432/database

# Next.js
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://your-staging-domain.vercel.app
```

### Verify in Vercel Dashboard
1. Go to Project Settings → Environment Variables
2. Confirm `DATABASE_URL` is NOT using `-pooler` endpoint
3. Set environment to "Preview" (staging) or "Production"

---

## Staging Deployment Steps

### Option 1: Vercel CLI (Recommended)

```bash
# 1. Install Vercel CLI (if not already)
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Link project (first time only)
vercel link

# 4. Deploy to staging (preview)
vercel --prod=false

# 5. Get deployment URL
# Vercel will output: https://fleet360-xxxxx.vercel.app
```

### Option 2: Git Push (Automatic)

```bash
# 1. Commit all changes
git add .
git commit -m "RLS migration complete - ready for staging"

# 2. Push to staging branch
git push origin staging

# Vercel automatically deploys preview builds from branches
# Check Vercel dashboard for deployment URL
```

### Option 3: Vercel Dashboard

1. Go to Vercel Dashboard → Your Project
2. Click "Deploy" → Select branch
3. Vercel builds and deploys automatically

---

## Post-Deployment Validation (Staging)

### 1. Health Check
```bash
# Check API is responding
curl https://your-staging-url.vercel.app/api/health

# Expected: {"status":"ok"}
```

### 2. Database Connection Test
```bash
# Test RLS configuration
curl https://your-staging-url.vercel.app/api/admin/info \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return tenant info without errors
```

### 3. Multi-Tenant Isolation Test

**Test Plan:**
1. Login as Tenant A user
2. Create a test vehicle/record
3. Note the record ID
4. Login as Tenant B user
5. Try to access Tenant A's record by ID
6. **Expected Result:** 404 or 403 (not found/forbidden)

```bash
# As Tenant A (note the ID)
curl -X POST https://staging-url/api/vehicles \
  -H "Authorization: Bearer TENANT_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Vehicle","status":"active"}'

# Response: {"id":"abc123",...}

# As Tenant B (try to access Tenant A's vehicle)
curl https://staging-url/api/vehicles/abc123 \
  -H "Authorization: Bearer TENANT_B_TOKEN"

# Expected: 404 Not Found (RLS blocks cross-tenant access)
```

### 4. Performance Baseline

```bash
# Measure API response times
for i in {1..10}; do
  time curl https://staging-url/api/vehicles \
    -H "Authorization: Bearer TOKEN" \
    -s -o /dev/null
done

# Note: Response times should be < 500ms
# RLS adds ~5-20ms overhead (acceptable)
```

### 5. Error Monitoring

Check Vercel logs for:
- ❌ `set_config returned null` - Database connection issue
- ❌ `withTenantRls: tenantId is required` - Authorization issue
- ❌ SQL errors related to `app.tenant_id`

---

## Production Deployment Steps

### Prerequisites
- [ ] All staging validation tests passed
- [ ] Performance benchmarks acceptable (< 10% degradation)
- [ ] No RLS-related errors in staging logs
- [ ] Stakeholder approval received

### Deploy to Production

```bash
# Option 1: Vercel CLI
vercel --prod

# Option 2: Git push to main
git checkout main
git merge staging
git push origin main

# Vercel automatically deploys from main branch
```

### Post-Production Monitoring

**First 1 Hour:**
- Monitor error rates every 5 minutes
- Watch for cross-tenant data leak reports
- Check query performance metrics

**First 24 Hours:**
- Review all RLS-related errors
- Validate user reports
- Monitor database performance

**First Week:**
- Daily compliance scans: `node scripts/check-tenant-rls.js`
- Review performance trends
- Document any edge cases found

---

## Rollback Procedures

### If Critical Issues Detected

**Vercel Instant Rollback:**
```bash
# Option 1: Vercel Dashboard
# 1. Go to Deployments
# 2. Find previous working deployment
# 3. Click "..." → "Promote to Production"

# Option 2: Vercel CLI
vercel rollback
```

**Git Rollback:**
```bash
# 1. Revert to previous commit
git revert HEAD
git push origin main

# 2. Or force reset (use with caution)
git reset --hard <previous-commit-sha>
git push --force origin main
```

### Post-Rollback Actions
1. Document the issue that caused rollback
2. Run compliance checks on current production
3. Fix issues in separate branch
4. Re-test in staging before re-deploying

---

## Database Migration (If Required)

### RLS Policies Migration

If RLS policies not yet applied to production database:

```bash
# 1. Backup production database
pg_dump $DATABASE_URL > backup_before_rls.sql

# 2. Apply RLS migration
npx prisma migrate deploy

# 3. Verify policies are active
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, policyname
  FROM pg_policies
  WHERE policyname LIKE '%tenant_isolation%'
  LIMIT 5;
"

# Expected: Shows RLS policies on tables
```

---

## Monitoring & Alerts

### Set Up Alerts (Recommended)

**Vercel:**
1. Project Settings → Integrations
2. Enable error tracking (Sentry, DataDog, etc.)
3. Set up alerts for:
   - Error rate > 1%
   - Response time > 2 seconds
   - Failed deployments

**Database:**
```sql
-- Monitor RLS overhead
SELECT
  query,
  calls,
  mean_exec_time,
  stddev_exec_time
FROM pg_stat_statements
WHERE query LIKE '%app.tenant_id%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## Troubleshooting Common Issues

### Issue: "set_config returned null"
**Cause:** Using connection pooler instead of direct connection  
**Fix:** Update `DATABASE_URL` to direct endpoint (remove `-pooler`)

### Issue: "Missing requireAuthorizedTenant"
**Cause:** Route not following three-layer pattern  
**Fix:** Run `node scripts/check-tenant-rls.js --files="route.ts"`

### Issue: Performance degradation > 10%
**Cause:** RLS policies adding query overhead  
**Fix:** 
1. Add indexes on `tenant_id` columns
2. Check `EXPLAIN ANALYZE` on slow queries
3. Consider query optimization

### Issue: Cross-tenant data leak
**Cause:** RLS policy not applied or bypassed  
**Fix:**
1. Immediate rollback
2. Audit the specific route
3. Check database policies: `\d+ table_name`

---

## Success Criteria

### Staging Must Meet:
- ✅ Zero RLS violations in logs
- ✅ Multi-tenant isolation working
- ✅ Performance < 10% degradation
- ✅ All cron jobs running successfully

### Production Must Meet:
- ✅ All staging criteria met
- ✅ 24 hours in staging without issues
- ✅ Stakeholder approval
- ✅ Rollback plan tested

---

## Deployment Commands Summary

```bash
# Pre-deployment validation
node scripts/check-tenant-rls.js        # 0 violations
node scripts/rls-smoke-test.js          # 5/5 passing
npm run typecheck                       # No errors
npm run build                           # Success

# Deploy to staging
vercel --prod=false                     # Preview deployment

# Deploy to production
vercel --prod                           # Production deployment

# Rollback if needed
vercel rollback                         # Instant rollback
```

---

## Next Steps

1. **Now:** Run pre-deployment validation
2. **Next:** Deploy to Vercel staging
3. **Then:** Complete staging validation checklist
4. **Finally:** Deploy to production after approval

---

## Support & Resources

- **Deployment Issues:** See this guide
- **RLS Violations:** [CI_INTEGRATION_GUIDE.md](CI_INTEGRATION_GUIDE.md)
- **Testing:** [INTEGRATION_TEST_RESULTS.md](INTEGRATION_TEST_RESULTS.md)
- **Complete Checklist:** [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

---

**Last Updated:** 2026-08-23  
**Platform:** Vercel  
**Status:** Ready for Deployment ✅
