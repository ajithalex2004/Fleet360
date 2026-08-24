#!/usr/bin/env node
/**
 * Comprehensive fix for body sanitization syntax errors
 * Fixes malformed try-catch blocks and body sanitization patterns
 */

const fs = require('fs');
const { execSync } = require('child_process');

console.log('Finding and fixing all syntax errors...\n');

const files = execSync('find src/app/api -name "*.ts" -type f', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let fixedCount = 0;

for (const file of files) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;

    // Pattern 1: Fix malformed body sanitization inside type definition
    // const bodyRaw = await req.json() as { field: type; const body = stripTenantOwnershipFields(bodyRaw); otherField: type; };
    content = content.replace(
      /const bodyRaw = await req\.json\(\) as \{([^}]*?)const body = stripTenantOwnershipFields\(bodyRaw\);([^}]*?)\};/gs,
      (match, before, after) => {
        const cleanBefore = before.trim();
        const cleanAfter = after.trim();
        return `const bodyRaw = await req.json() as { ${cleanBefore} ${cleanAfter} };\n        const body = stripTenantOwnershipFields(bodyRaw);`;
      }
    );

    // Pattern 2: Fix closing brace with orphaned catch
    // } catch (e) { ... without proper try
    content = content.replace(
      /(\s+)\}\s*catch\s*\([^)]*\)\s*\{/g,
      (match, indent) => {
        // Check if there's a try before this
        const beforeMatch = content.substring(0, content.indexOf(match));
        const lastTry = beforeMatch.lastIndexOf('try {');
        const lastCloseBrace = beforeMatch.lastIndexOf('}');

        // If the last } is after the last try, we need to add } catch
        if (lastCloseBrace > lastTry) {
          return `${indent}} catch (e) {`;
        }
        return match;
      }
    );

    // Pattern 3: Standalone stripTenantOwnershipFields without assignment
    // stripTenantOwnershipFields(bodyRaw); (should be: const body = ...)
    content = content.replace(
      /^\s*stripTenantOwnershipFields\(([^)]+)\);?\s*$/gm,
      '        const body = stripTenantOwnershipFields($1);'
    );

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`✓ Fixed ${file}`);
      fixedCount++;
    }
  } catch (err) {
    console.error(`✗ Error processing ${file}:`, err.message);
  }
}

console.log(`\n═══════════════════════════════════════`);
console.log(`Fixed ${fixedCount} files`);
console.log(`═══════════════════════════════════════\n`);
