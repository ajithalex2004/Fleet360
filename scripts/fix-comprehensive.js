#!/usr/bin/env node
/**
 * Comprehensive Body Sanitization Fixer
 * Handles all edge cases including multiline patterns
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getViolations() {
  try {
    const output = execSync('node scripts/check-tenant-rls.js 2>&1', {
      cwd: __dirname + '/..',
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
        const match = line.match(/(POST|PATCH|PUT|DELETE) handler should use stripTenantOwnershipFields/);
        if (match) {
          violations.push({ file: currentFile, handler: match[1] });
        }
      }
    }

    return violations;
  } catch (e) {
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
    return [];
  }
}

function ensureImport(content) {
  if (!content.includes('stripTenantOwnershipFields')) {
    const importMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@\/lib\/tenant-context['"]/);
    if (importMatch) {
      const imports = importMatch[1].trim();
      if (!imports.includes('stripTenantOwnershipFields')) {
        const newImports = imports + ', stripTenantOwnershipFields';
        content = content.replace(
          /import\s+{[^}]+}\s+from\s+['"]@\/lib\/tenant-context['"]/,
          `import { ${newImports} } from '@/lib/tenant-context'`
        );
      }
    }
  }
  return content;
}

function fixFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    return { status: 'not_found' };
  }

  let content = fs.readFileSync(fullPath, 'utf8');

  // Skip if already has sanitization
  if (/stripTenantOwnershipFields\s*\(/.test(content)) {
    return { status: 'already_fixed' };
  }

  // Check if file actually parses body
  if (!/await\s+req\.json\(\)/.test(content)) {
    return { status: 'no_body_parsing' };
  }

  const originalContent = content;

  // Ensure import exists
  content = ensureImport(content);

  let modified = false;

  // Pattern 1: const body = await req.json().catch(() => ({})) as { ... };
  // This can span multiple lines
  const pattern1 = /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(.+?\)\s*as\s*\{[^}]*\}\s*;/gs;
  if (pattern1.test(content)) {
    content = content.replace(pattern1, (match) => {
      const typeMatch = match.match(/as\s*(\{[^}]*\})\s*;/s);
      const typeAnnotation = typeMatch ? typeMatch[1] : '{}';
      const catchMatch = match.match(/\.catch\((.+?)\)\s*as/s);
      const catchHandler = catchMatch ? catchMatch[1] : '() => ({})';
      return `const bodyRaw = await req.json().catch(${catchHandler}) as ${typeAnnotation};\n    const body = stripTenantOwnershipFields(bodyRaw);`;
    });
    modified = true;
  }

  // Pattern 2: const body = await req.json().catch(() => ({}));
  if (!modified) {
    const pattern2 = /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(.+?\)\s*;/g;
    if (pattern2.test(content)) {
      content = content.replace(pattern2, (match) => {
        const catchMatch = match.match(/\.catch\((.+?)\)\s*;/);
        const catchHandler = catchMatch ? catchMatch[1] : '() => ({})';
        return `const bodyRaw = await req.json().catch(${catchHandler});\n    const body = stripTenantOwnershipFields(bodyRaw);`;
      });
      modified = true;
    }
  }

  // Pattern 3: const body = await req.json() as Type;
  if (!modified) {
    const pattern3 = /const\s+body\s*=\s*await\s+req\.json\(\)\s*as\s+([^;]+);/gs;
    if (pattern3.test(content)) {
      content = content.replace(pattern3, (match, typeAnnotation) => {
        return `const bodyRaw = await req.json() as ${typeAnnotation};\n    const body = stripTenantOwnershipFields(bodyRaw);`;
      });
      modified = true;
    }
  }

  // Pattern 4: const body = await req.json();
  if (!modified) {
    const pattern4 = /const\s+body\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern4.test(content)) {
      content = content.replace(pattern4,
        'const bodyRaw = await req.json();\n    const body = stripTenantOwnershipFields(bodyRaw);'
      );
      modified = true;
    }
  }

  // Pattern 5: const body = (await req.json()) as Type;
  if (!modified) {
    const pattern5 = /const\s+body\s*=\s*\(\s*await\s+req\.json\(\)\s*\)\s*as\s+([^;]+);/gs;
    if (pattern5.test(content)) {
      content = content.replace(pattern5, (match, typeAnnotation) => {
        return `const bodyRaw = (await req.json()) as ${typeAnnotation};\n    const body = stripTenantOwnershipFields(bodyRaw);`;
      });
      modified = true;
    }
  }

  // Pattern 6: try { const body = await req.json() ... }
  if (!modified) {
    const pattern6 = /try\s*{\s*const\s+body\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern6.test(content)) {
      content = content.replace(pattern6,
        'try { const bodyRaw = await req.json();\n      const body = stripTenantOwnershipFields(bodyRaw);'
      );
      modified = true;
    }
  }

  // Pattern 6b: try { body = await req.json(); } (reassignment)
  if (!modified) {
    const pattern6b = /try\s*{\s*body\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern6b.test(content)) {
      content = content.replace(pattern6b,
        'try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw);'
      );
      modified = true;
    }
  }

  // Pattern 7: let body = await req.json();
  if (!modified) {
    const pattern7 = /let\s+body\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern7.test(content)) {
      content = content.replace(pattern7,
        'let bodyRaw = await req.json();\n    let body = stripTenantOwnershipFields(bodyRaw);'
      );
      modified = true;
    }
  }

  // Pattern 8: const data = await req.json(); (variable name is not 'body')
  if (!modified) {
    const pattern8 = /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\s*;/g;
    const matches = content.match(pattern8);
    if (matches) {
      content = content.replace(pattern8, (match, varName) => {
        if (varName === 'body') return match; // Already handled
        return `const ${varName}Raw = await req.json();\n    const ${varName} = stripTenantOwnershipFields(${varName}Raw);`;
      });
      modified = true;
    }
  }

  // Pattern 9: const { field } = await req.json(); (destructured)
  if (!modified) {
    const pattern9 = /const\s+\{[^}]+\}\s*:\s*\{[^}]+\}\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern9.test(content)) {
      content = content.replace(pattern9, (match) => {
        const destructMatch = match.match(/const\s+(\{[^}]+\})\s*:\s*(\{[^}]+\})\s*=\s*await\s+req\.json\(\)\s*;/);
        if (destructMatch) {
          const destructure = destructMatch[1];
          const typeAnnotation = destructMatch[2];
          return `const bodyRaw = await req.json();\n    const body = stripTenantOwnershipFields(bodyRaw);\n    const ${destructure}: ${typeAnnotation} = body;`;
        }
        return match;
      });
      modified = true;
    }
  }

  // Pattern 10: const { field }: Type = await req.json(); (destructured with type)
  if (!modified) {
    const pattern10 = /const\s+\{[^}]+\}\s*=\s*await\s+req\.json\(\)\s*;/g;
    if (pattern10.test(content)) {
      content = content.replace(pattern10, (match) => {
        const destructMatch = match.match(/const\s+(\{[^}]+\})\s*=\s*await\s+req\.json\(\)\s*;/);
        if (destructMatch) {
          const destructure = destructMatch[1];
          return `const bodyRaw = await req.json();\n    const body = stripTenantOwnershipFields(bodyRaw);\n    const ${destructure} = body;`;
        }
        return match;
      });
      modified = true;
    }
  }

  if (modified && content !== originalContent) {
    // Create backup
    const backupPath = fullPath + '.bak-comprehensive';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, originalContent);
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    return { status: 'fixed' };
  }

  return { status: 'no_match' };
}

async function main() {
  console.log('🔧 Comprehensive body sanitization fix...\n');

  const violations = getViolations();
  console.log(`Found ${violations.length} violations\n`);

  const results = {
    fixed: [],
    already_fixed: [],
    no_body_parsing: [],
    no_match: [],
    not_found: [],
  };

  const uniqueFiles = [...new Set(violations.map(v => v.file))];

  for (const file of uniqueFiles) {
    const result = fixFile(file);
    results[result.status].push(file);

    const icon = {
      fixed: '✅',
      already_fixed: '✓',
      no_body_parsing: '⊘',
      no_match: '⚠️',
      not_found: '⏭️',
    }[result.status];

    console.log(`${icon} ${result.status.padEnd(20)} ${file}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`✅ Fixed:           ${results.fixed.length}`);
  console.log(`✓  Already fixed:   ${results.already_fixed.length}`);
  console.log(`⊘  No body parsing: ${results.no_body_parsing.length}`);
  console.log(`⚠️  No match:        ${results.no_match.length}`);
  console.log(`⏭️  Not found:       ${results.not_found.length}`);
  console.log(`📊 Total:           ${uniqueFiles.length}`);
  console.log('='.repeat(70));

  if (results.fixed.length > 0) {
    console.log('\n💾 Backups created with .bak-comprehensive extension');
    console.log('\n🔍 Run validation: node scripts/check-tenant-rls.js');
  }

  if (results.no_match.length > 0) {
    console.log('\n⚠️  Files with no matching patterns need manual review:');
    results.no_match.slice(0, 10).forEach(f => console.log(`   ${f}`));
    if (results.no_match.length > 10) {
      console.log(`   ... and ${results.no_match.length - 10} more`);
    }
  }
}

main().catch(console.error);
