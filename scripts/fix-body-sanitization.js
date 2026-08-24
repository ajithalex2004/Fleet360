#!/usr/bin/env node
/**
 * Automated Body Sanitization Fixer
 *
 * Adds stripTenantOwnershipFields() to routes that parse request bodies
 * but don't sanitize them.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../src/app/api');

// Get list of routes with body sanitization violations
function getViolatingRoutes() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('node scripts/check-tenant-rls.js 2>&1', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = output.split('\n');
    const violations = [];
    let currentFile = null;

    for (const line of lines) {
      if (line.startsWith('❌ src/app/api/')) {
        currentFile = line.replace('❌ ', '').trim();
      } else if (line.includes('stripTenantOwnershipFields') && currentFile) {
        // Extract handler type (POST, PATCH, PUT)
        const match = line.match(/(POST|PATCH|PUT|DELETE) handler should use stripTenantOwnershipFields/);
        if (match) {
          violations.push({ file: currentFile, handler: match[1] });
        }
      }
    }

    return violations;
  } catch (e) {
    // execSync throws on non-zero exit, but we still get output
    if (e.stdout) {
      const lines = e.stdout.toString().split('\n');
      const violations = [];
      let currentFile = null;

      for (const line of lines) {
        if (line.startsWith('❌ src/app/api/')) {
          currentFile = line.replace('❌ ', '').trim();
        } else if (line.includes('stripTenantOwnershipFields') && currentFile) {
          const match = line.match(/(POST|PATCH|PUT|DELETE) handler should use stripTenantOwnershipFields/);
          if (match) {
            violations.push({ file: currentFile, handler: match[1] });
          }
        }
      }
      return violations;
    }
    console.error('Error running check-tenant-rls.js:', e.message);
    return [];
  }
}

function addBodySanitization(filePath, handler) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  Skip: ${filePath} (not found)`);
    return false;
  }

  let content = fs.readFileSync(fullPath, 'utf8');

  // Check if stripTenantOwnershipFields is already imported
  const hasImport = content.includes('stripTenantOwnershipFields');

  // Add import if missing
  if (!hasImport) {
    // Find the tenant-context import line
    const tenantImportMatch = content.match(/import\s+{[^}]*}\s+from\s+['"]@\/lib\/tenant-context['"]/);
    if (tenantImportMatch) {
      const oldImport = tenantImportMatch[0];
      // Add stripTenantOwnershipFields to existing import
      const newImport = oldImport.replace(
        /from\s+['"]@\/lib\/tenant-context['"]/,
        match => {
          const beforeFrom = oldImport.substring(0, oldImport.indexOf('from'));
          if (beforeFrom.includes('stripTenantOwnershipFields')) {
            return match; // Already has it
          }
          return beforeFrom.trimEnd() + ', stripTenantOwnershipFields } from \'@/lib/tenant-context\'';
        }
      );
      content = content.replace(oldImport, newImport);
    } else {
      console.log(`⚠️  Skip: ${filePath} (no tenant-context import)`);
      return false;
    }
  }

  // Find the handler function
  const handlerRegex = new RegExp(
    `export\\s+async\\s+function\\s+${handler}\\s*\\([^)]+\\)\\s*{`,
    'g'
  );

  const handlerMatch = content.match(handlerRegex);
  if (!handlerMatch) {
    console.log(`⚠️  Skip: ${filePath} (no ${handler} handler found)`);
    return false;
  }

  // Find body parsing patterns
  const bodyPatterns = [
    // Standard patterns
    /const\s+(\w+)\s*=\s*(?:\(?\s*await\s+req\.json\(\)\s*\)?)\s*(?:as\s+[^;]+)?;/g,
    /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\s*as\s+[^;]+;/g,
    /let\s+(\w+)\s*=\s*(?:await\s+)?req\.json\(\);?/g,
    // With .catch() handler
    /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\.catch\([^)]+\)\s*(?:as\s+[^;]+)?;/g,
    // Try/catch patterns
    /(?:const|let)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:\(?\s*await\s+req\.json\(\)\s*\)?)\s*as\s+[^;]+;/g,
  ];

  let modified = false;

  for (const pattern of bodyPatterns) {
    pattern.lastIndex = 0; // Reset regex
    const matches = [...content.matchAll(pattern)];

    for (const match of matches) {
      const fullMatch = match[0];
      const varName = match[1];

      // Check if already sanitized
      if (content.includes(`stripTenantOwnershipFields(${varName})`)) {
        continue;
      }

      // Check if this is inside the correct handler
      const matchIndex = content.indexOf(fullMatch);
      const handlerIndex = content.indexOf(handlerMatch[0]);

      if (matchIndex < handlerIndex) {
        continue; // Not in this handler
      }

      // Find the next handler to ensure we're in the right one
      const nextHandlerMatch = content.substring(matchIndex).match(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/);
      if (nextHandlerMatch) {
        const nextHandlerIndex = matchIndex + content.substring(matchIndex).indexOf(nextHandlerMatch[0]);
        if (handlerIndex > matchIndex || (nextHandlerIndex < matchIndex && nextHandlerMatch[1] !== handler)) {
          continue;
        }
      }

      // Create sanitized version
      let replacement;
      if (fullMatch.includes('as ')) {
        // Has type annotation: const body = await req.json() as Type;
        const typeMatch = fullMatch.match(/as\s+([^;]+);/);
        const typeName = typeMatch ? typeMatch[1].trim() : 'unknown';
        replacement = `const ${varName}Raw = await req.json() as ${typeName};\n  const ${varName} = stripTenantOwnershipFields(${varName}Raw);`;
      } else {
        // No type annotation
        replacement = `const ${varName}Raw = await req.json();\n  const ${varName} = stripTenantOwnershipFields(${varName}Raw);`;
      }

      content = content.replace(fullMatch, replacement);
      modified = true;
      console.log(`✅ Fixed: ${filePath} (${handler} handler, variable: ${varName})`);
      break; // Only fix first occurrence per handler
    }
  }

  if (modified) {
    // Create backup
    const backupPath = fullPath + '.bak-sanitize';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, fs.readFileSync(fullPath));
    }

    // Write modified content
    fs.writeFileSync(fullPath, content, 'utf8');
    return true;
  }

  console.log(`⚠️  Skip: ${filePath} (no body parsing found for ${handler})`);
  return false;
}

async function main() {
  console.log('🔍 Finding routes with body sanitization violations...\n');

  const violations = getViolatingRoutes();
  console.log(`Found ${violations.length} violations\n`);

  let fixed = 0;
  let skipped = 0;

  for (const { file, handler } of violations) {
    if (addBodySanitization(file, handler)) {
      fixed++;
    } else {
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Fixed: ${fixed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📊 Total: ${violations.length}`);
  console.log('='.repeat(60));

  if (fixed > 0) {
    console.log('\n💾 Backups created with .bak-sanitize extension');
    console.log('🔍 Run: node scripts/check-tenant-rls.js');
  }
}

main().catch(console.error);
