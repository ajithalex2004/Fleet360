/**
 * Apply a prisma/migrations/<name>/migration.sql and record it in
 * _prisma_migrations, running every statement inside one transaction so a
 * failure anywhere rolls the whole migration back.
 *
 * Usage:
 *   node scripts/apply-migration.cjs <migration_dir_name> [more...]
 *
 * Why this exists rather than `prisma migrate deploy`: several migrations in
 * this repo were applied out of band, and the shadow-database step is not
 * usable against this Neon instance. This applies the same SQL and writes the
 * same bookkeeping row, so `migrate status` stays consistent.
 */

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Split SQL on top-level ';'.
 *
 * Must skip: -- line comments, block comments, '...' literals (with ''
 * escapes) and $tag$...$tag$ blocks.
 *
 * A first version handled only dollar-quoting and split inside a prose comment
 * that contained a semicolon — "correctly implemented; the data model is what
 * leaks" — producing a fragment beginning "the data model...", which Postgres
 * reported as `42601 syntax error at or near "the"`. Comments are not inert to
 * a splitter.
 */
function split(sql) {
  const out = [];
  let buf = '';
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith('--')) {
      const e = sql.indexOf('\n', i);
      const end = e < 0 ? sql.length : e;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (rest.startsWith('/*')) {
      const e = sql.indexOf('*/', i + 2);
      const end = e < 0 ? sql.length : e + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    const dq = /^\$([A-Za-z_]*)\$/.exec(rest);
    if (dq) {
      const tag = dq[0];
      const e = sql.indexOf(tag, i + tag.length);
      const end = e < 0 ? sql.length : e + tag.length;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    if (sql[i] === ';') { out.push(buf); buf = ''; i++; continue; }
    buf += sql[i++];
  }
  out.push(buf);

  const stripped = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  return out.filter(s => stripped(s).length > 0).map(s => s.trim());
}

async function warm() {
  for (let i = 0; i < 6; i++) {
    try { await prisma.$queryRawUnsafe('SELECT 1'); return; }
    catch { await new Promise(r => setTimeout(r, 4000)); }
  }
  throw new Error('database unreachable');
}

async function main() {
  await warm();

  for (const name of process.argv.slice(2)) {
    const path = `prisma/migrations/${name}/migration.sql`;
    const sql = fs.readFileSync(path, 'utf8');
    const stmts = split(sql);

    console.log(`\n=== ${name}  (${stmts.length} statements)`);
    stmts.forEach((s, n) => {
      const head = s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
      console.log(`   [${n + 1}] ${head}...`);
    });

    const already = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`, name);
    if (already.length) { console.log('   already recorded - skipping'); continue; }

    const started = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        for (const s of stmts) await tx.$executeRawUnsafe(s);
      }, { timeout: 240000, maxWait: 20000 });

      await prisma.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations
           (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, NULL, NULL, $4, 1)`,
        crypto.randomUUID(),
        crypto.createHash('sha256').update(sql).digest('hex'),
        name,
        started,
      );
      console.log('   APPLIED and recorded');
    } catch (e) {
      console.log('   FAILED, rolled back:');
      console.log('      ' + String(e.message).split('\n').filter(l => l.trim()).slice(0, 8).join('\n      '));
      process.exit(1);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n')[0]);
  await prisma.$disconnect();
  process.exit(1);
});
