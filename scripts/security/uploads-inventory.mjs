#!/usr/bin/env node
/**
 * Stored-file inventory (read-only).
 *
 * Lists every file in the upload directory with the tenant and record that
 * own it, and every database link to /uploads/* whose file is missing. Use
 * it to size the exposure of files that were served from public/uploads
 * without authorization, and before moving files to private storage.
 *
 * Usage (on the host or volume that holds the uploads):
 *   DATABASE_URL=... [FILE_STORAGE_DIR=/app/public/uploads] \
 *     node scripts/security/uploads-inventory.mjs > uploads-inventory.csv
 *
 * The connection must be able to read every tenant's rows (RLS limits the
 * application role to one tenant), e.g. the database owner. The script only
 * runs SELECT statements. Output: CSV on stdout, summary on stderr.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(process.env.FILE_STORAGE_DIR || path.join(process.cwd(), 'public', 'uploads'));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const prisma = new PrismaClient({ log: ['error'] });

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

const csv = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function owner(key) {
  const url = `/uploads/${key}`;
  const [top, second, third] = key.split('/');
  if (top === 'branding') {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id::text AS tenant_id, (brand_logo_url = $1) AS current FROM tenants WHERE id::text = $2', url, second);
    return rows[0]
      ? { category: 'branding', tenantId: rows[0].tenant_id, record: rows[0].current ? 'current logo' : 'old logo', found: true }
      : { category: 'branding', tenantId: second, record: 'tenant not found', found: false };
  }
  if (top === 'leasing' || top === 'leasing-portal') {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT tenant_id::text AS tenant_id, entity_type, entity_id, doc_type FROM lease_documents WHERE file_url = $1', url);
    return rows[0]
      ? { category: 'lease-document', tenantId: rows[0].tenant_id, record: `${rows[0].entity_type} ${rows[0].entity_id} (${rows[0].doc_type})`, found: true }
      : { category: 'lease-document', tenantId: '', record: 'no lease_documents row', found: false };
  }
  if (top === 'rental' && second === 'handover') {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT tenant_id::text AS tenant_id, booking_ref FROM rental_bookings WHERE id::text = $1', third);
    return rows[0]
      ? { category: 'rental-handover', tenantId: rows[0].tenant_id, record: `booking ${rows[0].booking_ref ?? third}`, found: true }
      : { category: 'rental-handover', tenantId: '', record: 'booking not found', found: false };
  }
  return { category: 'unknown', tenantId: '', record: 'unknown prefix', found: false };
}

const files = walk(root);
console.log(['key', 'bytes', 'modified_utc', 'category', 'tenant_id', 'owning_record', 'owner_found'].join(','));
const byCategory = {};
let orphans = 0;
for (const abs of files) {
  const key = path.relative(root, abs).split(path.sep).join('/');
  const st = fs.statSync(abs);
  const o = await owner(key);
  byCategory[o.category] = (byCategory[o.category] ?? 0) + 1;
  if (!o.found) orphans++;
  console.log([key, st.size, st.mtime.toISOString(), o.category, o.tenantId, o.record, o.found].map(csv).join(','));
}

// Database links whose file is not on this disk (lost on a redeploy, or on another host).
const links = await prisma.$queryRawUnsafe(
  "SELECT tenant_id::text AS tenant_id, file_url FROM lease_documents WHERE file_url LIKE '/uploads/%'");
const missing = links.filter((l) => !fs.existsSync(path.join(root, ...l.file_url.slice('/uploads/'.length).split('/'))));

console.error(`Upload directory: ${root}`);
console.error(`Files: ${files.length} ${JSON.stringify(byCategory)}; without an owning record: ${orphans}`);
console.error(`lease_documents links to /uploads: ${links.length}; file missing on this disk: ${missing.length}`);
for (const m of missing.slice(0, 20)) console.error(`  missing: tenant ${m.tenant_id} ${m.file_url}`);
await prisma.$disconnect();
