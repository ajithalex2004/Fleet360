/**
 * linkuser.js — DEV/OPERATIONS ONLY
 *
 * Links a specific user to the SUPER_ADMIN role for an existing tenant.
 * Used during tenant bootstrapping and operator account recovery.
 *
 * Hardcoded target:
 *   email = alex@exlsolutions.ae  (the platform founder / SRE operator)
 *
 * Run:    node linkuser.js
 * Needs:  DATABASE_URL in env (.env.local or shell)
 *
 * NOTE: This is a one-shot ops script. It is NOT an API. Do NOT add a
 * route handler, do NOT call this from a server action. It exists at the
 * repo root as a convenience for the operator. Move into scripts/ if
 * the team grows past one operator.
 */

const crypto = require('crypto');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();