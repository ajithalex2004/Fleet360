/**
 * reproduce_issue.js — DEV/DEBUG ONLY.
 *
 * Reproduces a maintenance-request update flow against a locally-running
 * Next.js dev server. Used while debugging update-side bugs in the
 * maintenance module.
 *
 * Run:    node reproduce_issue.js
 * Needs:  Next.js dev server on http://localhost:3000
 *         at least one MaintenanceRequest row in the DB
 *
 * Not a test. Not idempotent. Not safe to run against prod.
 */

const fetch = require('node-fetch');