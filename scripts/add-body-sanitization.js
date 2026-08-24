#!/usr/bin/env node
/**
 * Add Body Sanitization to Migrated Routes
 *
 * Adds stripTenantOwnershipFields() to POST/PUT/PATCH handlers
 * that already use withTenantRls but are missing body sanitization.
 *
 * Usage:
 *   node scripts/add-body-sanitization.js <route-file>
 *   node scripts/add-body-sanitization.js --batch "src/app/api/**/*.ts"
 */

const fs = require('fs');
const path = require('path');

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH'];

function backup(filePath) {
  const bakPath = filePath + '.bak2';
  fs.copyFileSync(filePath, bakPath);
  console.log(`✓ Backup created: ${bakPath}`);
}

function hasImport(content, importName) {
  const pattern = new RegExp(`import\\s+\\{[^}]*${importName}[^}]*\\}\\s+from`);
  return pattern.test(content);
}

function addImportIfMissing(content, importName, importPath) {
  if (hasImport(content, importName)) {
    return content;
  }

  const modulePattern = new RegExp(
    `(import\\s+\\{)([^}]*)(\\}\\s+from\\s+['"]${importPath.replace(/\//g, '\\/')}['"])`,
    'g'
  );

  const match = modulePattern.exec(content);
  if (match) {
    const existingImports = match[2].trim();
    const newImports = existingImports ? `${existingImports}, ${importName}` : importName;
    return content.replace(
      modulePattern,
      `import { ${newImports} } from '${importPath}'`
    );
  }

  const firstImportIndex = content.indexOf('import ');
  if (firstImportIndex === -1) {
    return `import { ${importName} } from '${importPath}';\n${content}`;
  }

  const firstImportEnd = content.indexOf('\n', firstImportIndex);
  return (
    content.slice(0, firstImportEnd + 1) +
    `import { ${importName} } from '${importPath}';\n` +
    content.slice(firstImportEnd + 1)
  );
}

function addBodySanitization(content, dryRun = false) {
  let modified = false;

  // Add import if missing
  content = addImportIfMissing(content, 'stripTenantOwnershipFields', '@/lib/tenant-context');

  // Find handlers that need sanitization
  for (const method of MUTATION_METHODS) {
    const handlerRegex = new RegExp(
      `export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`,
      'gm'
    );

    content = content.replace(handlerRegex, (handler) => {
      // Check if already has sanitization
      if (/stripTenantOwnershipFields/.test(handler)) {
        return handler;
      }

      // Check if has body = await req.json()
      const bodyMatch = handler.match(/const\s+body\s+=\s+await\s+req\.json\(\);/);
      if (!bodyMatch) {
        return handler;
      }

      // Replace with sanitized version
      modified = true;
      console.log(`  ✓ Adding body sanitization to ${method} handler`);

      return handler.replace(
        /const\s+body\s+=\s+await\s+req\.json\(\);/,
        `const bodyRaw = await req.json();\n  const body = stripTenantOwnershipFields(bodyRaw);`
      );
    });
  }

  return { content, modified };
}

function processFile(filePath, dryRun = false) {
  console.log(`\n📁 Processing: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  const { content, modified } = addBodySanitization(originalContent, dryRun);

  if (!modified) {
    console.log('⊘ No changes needed');
    return false;
  }

  if (dryRun) {
    console.log('\n📄 Dry-run mode - changes not saved');
    return true;
  }

  backup(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Body sanitization added: ${filePath}`);

  return true;
}

function processBatch(pattern, dryRun = false) {
  const glob = require('glob');
  const files = glob.sync(pattern);

  console.log(`\n🔄 Batch processing: ${files.length} files matching "${pattern}"\n`);

  let successCount = 0;
  for (const file of files) {
    if (processFile(file, dryRun)) {
      successCount++;
    }
  }

  console.log(`\n✅ Modified ${successCount} of ${files.length} files`);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batch = args.includes('--batch');

  const targetArgs = args.filter(a => !a.startsWith('--'));

  if (targetArgs.length === 0) {
    console.log(`
Add Body Sanitization Script

Usage:
  Single file:
    node scripts/add-body-sanitization.js <route-file> [--dry-run]

  Batch:
    node scripts/add-body-sanitization.js --batch "src/app/api/**/*.ts" [--dry-run]
`);
    process.exit(0);
  }

  if (batch) {
    processBatch(targetArgs[0], dryRun);
  } else {
    processFile(targetArgs[0], dryRun);
  }
}

main();
