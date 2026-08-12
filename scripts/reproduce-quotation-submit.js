/**
 * reproduce_quotation_submit.js — DEV/DEBUG ONLY.
 *
 * Reproduces a quotation-submit flow against a locally-running Next.js
 * dev server. Used while debugging payload / attachment-type mismatches
 * between the quotation UI and the API.
 *
 * Run:    node reproduce_quotation_submit.js
 * Needs:  Next.js dev server on http://localhost:3000
 *         at least one MaintenanceRequest row in the DB
 *
 * Not a test. Not idempotent. Not safe to run against prod.
 */

const fetch = require('node-fetch');