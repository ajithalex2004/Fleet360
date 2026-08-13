#!/usr/bin/env node
/**
 * Add `@@schema("public")` to every Prisma model in schema.prisma
 * that doesn't already have a `@@schema` attribute. Idempotent —
 * re-running this script is a no-op.
 *
 * Why: the `multiSchema` preview feature is enabled in the generator
 * and the datasource declares `schemas = ["public", "finance", "ai"]`.
 * With multiSchema, every model must declare which schema it lives
 * in. ~17 Finance models already have `@@schema("finance")`. The
 * other ~185 legacy models are missing it, which causes
 * `prisma generate` to fail with ~190 validation errors.
 *
 * This script is the minimal fix: every model without a schema
 * goes to `public` (the default). Models can be moved to other
 * schemas later as the data ownership work progresses.
 *
 * Run:  node scripts/add-missing-schemas.mjs
 * Roll back:  cp prisma/schema.prisma.bak prisma/schema.prisma
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'prisma', 'schema.prisma');

const content = fs.readFileSync(SCHEMA_PATH, 'utf8');
const lines = content.split('\n');

// First pass: find all model and enum blocks and their boundaries
const modelBlocks = [];
const enumBlocks = [];
let inBlock = false;
let inEnum = false;
let blockName = '';
let blockBraceDepth = 0;
let hasSchema = false;
let blockStartLine = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
  const enumMatch = line.match(/^enum\s+(\w+)\s*\{/);
  if (modelMatch) {
    inBlock = true;
    inEnum = false;
    blockName = modelMatch[1];
    blockStartLine = i;
    blockBraceDepth = 1;
    hasSchema = false;
    continue;
  }
  if (enumMatch) {
    inBlock = true;
    inEnum = true;
    blockName = enumMatch[1];
    blockStartLine = i;
    blockBraceDepth = 1;
    hasSchema = false;
    continue;
  }
  if (!inBlock) continue;

  const openBraces = (line.match(/\{/g) || []).length;
  const closeBraces = (line.match(/\}/g) || []).length;
  blockBraceDepth += openBraces - closeBraces;

  if (/@@schema\b/.test(line)) hasSchema = true;

  if (blockBraceDepth === 0) {
    const entry = {
      startLine: blockStartLine,
      endLine: i,
      hasSchema,
      name: blockName,
    };
    if (inEnum) enumBlocks.push(entry);
    else modelBlocks.push(entry);
    inBlock = false;
    inEnum = false;
  }
}

// Second pass: for each model or enum without @@schema, find the best
// insertion point. For models: after the last @@index/@@unique/@@map/@@id
// line, or before the closing brace. For enums: before the closing brace
// (enums don't have model-level attributes).
const edits = [];
function planEdits(blocks, kind) {
  for (const block of blocks) {
    if (block.hasSchema) continue;

    let insertAt = -1;
    if (kind === 'model') {
      for (let j = block.endLine - 1; j > block.startLine; j--) {
        if (/@@(index|unique|map|id)\b/.test(lines[j])) {
          insertAt = j + 1;
          break;
        }
      }
    }
    if (insertAt === -1) insertAt = block.endLine;

    const reference = lines[insertAt] || lines[block.endLine];
    const indent = (reference.match(/^(\s*)/) || ['', '  '])[1] || '  ';

    edits.push({ kind, name: block.name, insertAt, indent });
  }
}
planEdits(modelBlocks, 'model');
planEdits(enumBlocks, 'enum');

// Apply edits in reverse order so line numbers don't shift
edits.sort((a, b) => b.insertAt - a.insertAt);
for (const edit of edits) {
  lines.splice(edit.insertAt, 0, `${edit.indent}@@schema("public")`);
}

fs.writeFileSync(SCHEMA_PATH, lines.join('\n'));

// Report
console.log(`Found ${modelBlocks.length} models and ${enumBlocks.length} enums.`);
console.log(`Models needing fix: ${edits.filter((e) => e.kind === 'model').length}.`);
console.log(`Enums needing fix: ${edits.filter((e) => e.kind === 'enum').length}.`);
console.log('---');
for (const edit of edits) {
  console.log(`  + ${edit.kind} ${edit.name}`);
}
