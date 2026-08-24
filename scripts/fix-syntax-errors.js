#!/usr/bin/env node
/**
 * Fix stray ", { status: 401 });" fragments across all route files
 */

const fs = require('fs');
const { execSync } = require('child_process');

console.log('Finding all files with stray error fragments...\n');

// Find all TypeScript files in api directory
const files = execSync('find src/app/api -name "*.ts" -type f', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let fixedCount = 0;
let totalReplacements = 0;

for (const file of files) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;

    // Pattern 1: const { tenantId } = authz;, { status: 401 });
    content = content.replace(/const \{ ([^}]+) \} = authz;,\s*\{\s*status:\s*401\s*\}\);/g, 'const { $1 } = authz;');

    // Pattern 2: Standalone , { status: 401 }); at start of line
    content = content.replace(/^\s*,\s*\{\s*status:\s*401\s*\}\);?\s*$/gm, '');

    // Pattern 3: After withTenantRls opening brace
    content = content.replace(/withTenantRls\([^,]+,\s*[^,]+,\s*async\s*\([^)]*\)\s*=>\s*\{\s*,\s*\{\s*status:\s*401\s*\}\);/g,
                              (match) => match.replace(/, \{ status: 401 \}\);/, ''));

    // Pattern 4: }), { status: 401, headers: ... });
    content = content.replace(/\}\),\s*\{\s*status:\s*401,\s*headers:\s*\{[^}]*\}\s*\}\);?\s*\}/g, '}');

    // Pattern 5: Misplaced try-catch blocks
    content = content.replace(/\}\);\s*\}\s*catch\s*\(/g, '} catch (');

    if (content !== originalContent) {
      const replacements = (originalContent.match(/, \{ status: 401 \}\);/g) || []).length;
      fs.writeFileSync(file, content, 'utf8');
      console.log(`✓ Fixed ${file} (${replacements} replacements)`);
      fixedCount++;
      totalReplacements += replacements;
    }
  } catch (err) {
    console.error(`✗ Error processing ${file}:`, err.message);
  }
}

console.log(`\n═══════════════════════════════════════`);
console.log(`Fixed ${fixedCount} files`);
console.log(`Total replacements: ${totalReplacements}`);
console.log(`═══════════════════════════════════════\n`);

process.exit(0);
