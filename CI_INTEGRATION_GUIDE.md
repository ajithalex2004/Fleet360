# Phase 4: CI Integration - Complete Setup Guide

## Overview

This phase integrates tenant RLS compliance checks into the development workflow to prevent security regressions.

## Components

### 1. GitHub Actions Workflow ✅

**File:** `.github/workflows/tenant-rls-check.yml`

**Triggers:**
- Pull requests modifying API routes
- Pushes to main/develop branches

**Features:**
- Runs `check-tenant-rls.js` validation
- Extracts summary for GitHub step summary
- Uploads compliance report as artifact
- Auto-comments on PRs with violations
- Fails CI if violations found

**Usage:**
```bash
# Automatically runs on PR creation/updates
# View results in PR checks tab
```

### 2. Pre-commit Hook ✅

**File:** `scripts/githooks/pre-commit`

**Features:**
- Checks only staged API route files
- Fast validation before commit
- Provides helpful error messages
- Can be bypassed with --no-verify if needed

**Installation:**
```bash
npm run setup-hooks
```

**Usage:**
```bash
# Automatically runs on every commit
git commit -m "Add new API route"

# To bypass (not recommended):
git commit --no-verify -m "WIP: incomplete route"
```

### 3. NPM Scripts ✅

**Already configured in package.json:**

```bash
# Check RLS compliance for all routes
npm run tenant:check-rls

# Full tenant security audit
npm run tenant:audit

# Individual checks
npm run tenant:check-auth    # Authorization checks
npm run tenant:check-schema  # Database schema validation
```

## Enforcement Levels

### Level 1: Local Development (Pre-commit Hook)
- **When:** Before each commit
- **Scope:** Only staged API route files
- **Action:** Warns developer, blocks commit if violations found
- **Bypass:** Possible with --no-verify (not recommended)

### Level 2: Pull Request (GitHub Actions)
- **When:** PR opened or updated
- **Scope:** All API routes in PR
- **Action:** 
  - Fails PR checks if violations found
  - Posts comment with violation details
  - Uploads detailed report as artifact
- **Bypass:** Not possible without approval

### Level 3: Main Branch Protection
- **When:** Push to main/develop
- **Scope:** All modified routes
- **Action:** Prevents merge if checks fail
- **Bypass:** Requires admin override

## Configuration

### GitHub Branch Protection (Recommended)

Add to repository settings:

```yaml
Branch Protection Rules for main/develop:
- ✅ Require status checks to pass before merging
  - ✅ check-rls-compliance
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
```

### Custom Validation Options

Edit `scripts/check-tenant-rls.js` to adjust:

```javascript
const opts = {
  strict: false,        // Set true for stricter validation
  verbose: false,       // Set true for detailed output
  exemptPatterns: [...] // Add patterns to exempt
};
```

## Monitoring & Reports

### GitHub Actions Artifacts

Every CI run produces:
- `rls-compliance-report.txt` - Full validation output
- Retained for 30 days
- Download from Actions tab

### Pull Request Comments

Automated comments include:
- Number of violations found
- Specific violation details
- Remediation instructions
- Links to documentation

### Step Summary

GitHub Actions step summary shows:
- Total routes checked
- Compliant routes count
- Violations count
- Warnings count

## Troubleshooting

### Pre-commit Hook Not Running

```bash
# Reinstall hooks
npm run setup-hooks

# Verify hook is executable (Unix/Mac)
chmod +x scripts/githooks/pre-commit

# Check git config
git config core.hooksPath
# Should output: scripts/githooks
```

### CI Check Failing But Local Check Passes

```bash
# Ensure dependencies are installed
npm ci

# Run exact CI command locally
node scripts/check-tenant-rls.js > rls-report.txt 2>&1
cat rls-report.txt
```

### False Positives

Update exempt patterns in `scripts/check-tenant-rls.js`:

```javascript
const EXEMPT_PATTERNS = [
  /^src\/app\/api\/setup\//,
  /^src\/app\/api\/health\//,
  /^src\/app\/api\/webhooks\//,
  // Add your pattern here
];
```

## Best Practices

### For Developers

1. **Run checks before committing:**
   ```bash
   npm run tenant:check-rls
   ```

2. **Fix violations immediately:**
   - Don't bypass pre-commit hooks
   - Address violations before requesting review

3. **Use helper functions:**
   ```typescript
   import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
   import { withTenantRls } from '@/lib/rls';
   ```

### For Reviewers

1. **Check CI results first**
   - Don't approve PRs with failing RLS checks
   - Verify violation fixes are correct

2. **Review security implications**
   - Ensure tenant isolation is maintained
   - Check for proper authorization

3. **Look for exemption abuse**
   - Question new exempt routes
   - Verify legitimate reasons for bypasses

## Migration Checklist

- ✅ Created GitHub Actions workflow
- ✅ Created pre-commit hook
- ✅ Added npm scripts (already present)
- ✅ Updated documentation
- ⏳ Enable branch protection rules (manual step)
- ⏳ Train team on new workflow (manual step)

## Testing CI Integration

### Test Pre-commit Hook

```bash
# Make a violation in a test file
echo "// Missing auth" >> src/app/api/test-route/route.ts
git add src/app/api/test-route/route.ts
git commit -m "Test violation"
# Should fail with violation message

# Fix the violation
# Should now pass
```

### Test GitHub Actions

1. Create a PR with API route changes
2. Verify workflow runs automatically
3. Check step summary and comments
4. Download artifact and review report

## Metrics & KPIs

Track these metrics over time:
- **Violation Rate:** Violations per PR
- **Fix Time:** Time from violation detected to fixed
- **Bypass Rate:** Number of --no-verify commits
- **Compliance Score:** % of routes passing checks

## Next Steps

1. **Enable branch protection** in GitHub repository settings
2. **Train development team** on RLS compliance requirements
3. **Monitor CI runs** for patterns and issues
4. **Update exempt patterns** as needed
5. **Review and refine** validation rules based on feedback

## Support & Resources

- **Migration Guide:** [MIGRATION_PROGRESS.md](MIGRATION_PROGRESS.md)
- **Body Sanitization Guide:** [BODY_SANITIZATION_COMPLETE.md](BODY_SANITIZATION_COMPLETE.md)
- **RLS Wrapper Docs:** [docs/rls-wrappers.md](docs/rls-wrappers.md)
- **Validation Script:** [scripts/check-tenant-rls.js](scripts/check-tenant-rls.js)

---

## Summary

✅ **CI Integration Complete**
- GitHub Actions workflow configured
- Pre-commit hook installed
- NPM scripts ready
- Documentation complete

**Next Action:** Enable branch protection rules in GitHub repository settings

**Status:** Ready for production use 🚀
