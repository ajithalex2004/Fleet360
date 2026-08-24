#!/usr/bin/env node
/**
 * Analyze remaining violations - check if they actually parse bodies
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getViolations() {
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
        const match = line.match(/(POST|PATCH|PUT|DELETE) handler/);
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
          const match = line.match(/(POST|PATCH|PUT|DELETE) handler/);
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

function analyzeFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    return { type: 'not_found', pattern: null };
  }

  const content = fs.readFileSync(fullPath, 'utf8');

  // Check for different body parsing patterns
  if (/stripTenantOwnershipFields/.test(content)) {
    return { type: 'already_fixed', pattern: null };
  }

  if (!/await\s+req\.json\(\)/.test(content)) {
    return { type: 'no_body_parsing', pattern: null };
  }

  // Detect specific patterns
  if (/const\s+\w+\s*=\s*await\s+req\.json\(\)\.catch\(.+?\)\s*;/.test(content)) {
    return { type: 'needs_fix', pattern: 'catch_simple' };
  }

  if (/const\s+\w+\s*=\s*await\s+req\.json\(\)\.catch\(.+?\)\s*as\s*.+?;/s.test(content)) {
    return { type: 'needs_fix', pattern: 'catch_with_type' };
  }

  if (/try\s*{\s*\w+\s*=\s*await\s+req\.json\(\)/.test(content)) {
    return { type: 'needs_fix', pattern: 'try_catch_reassign' };
  }

  if (/const\s+\{\s*\w+/.test(content) && /await\s+req\.json\(\)/.test(content)) {
    return { type: 'needs_fix', pattern: 'destructured' };
  }

  if (/const\s+\w+\s*=\s*await\s+req\.json\(\)\s*;/.test(content)) {
    return { type: 'needs_fix', pattern: 'simple' };
  }

  if (/const\s+\w+\s*=\s*await\s+req\.json\(\)\s*as\s+/.test(content)) {
    return { type: 'needs_fix', pattern: 'with_type' };
  }

  // Check for schema validation patterns (Zod, etc)
  if (/\.safeParse\(/.test(content) || /\.parse\(/.test(content)) {
    const jsonMatch = content.match(/const\s+(\w+)\s*=\s*await\s+req\.json\(\)/);
    if (jsonMatch) {
      return { type: 'needs_fix', pattern: 'schema_validation', varName: jsonMatch[1] };
    }
  }

  return { type: 'needs_fix', pattern: 'unknown' };
}

async function main() {
  console.log('🔍 Analyzing remaining violations...\n');

  const violations = getViolations();
  console.log(`Found ${violations.length} violations\n`);

  const categories = {
    already_fixed: [],
    no_body_parsing: [],
    needs_fix: {},
    not_found: [],
  };

  for (const { file, handler } of violations) {
    const analysis = analyzeFile(file);

    if (analysis.type === 'needs_fix') {
      if (!categories.needs_fix[analysis.pattern]) {
        categories.needs_fix[analysis.pattern] = [];
      }
      categories.needs_fix[analysis.pattern].push({ file, handler, varName: analysis.varName });
    } else {
      categories[analysis.type].push({ file, handler });
    }
  }

  console.log('═'.repeat(70));
  console.log('ANALYSIS RESULTS');
  console.log('═'.repeat(70));

  console.log(`\n✅ Already Fixed: ${categories.already_fixed.length}`);
  console.log(`⊘  No Body Parsing: ${categories.no_body_parsing.length} (FALSE POSITIVES)`);
  console.log(`⏭️  Not Found: ${categories.not_found.length}`);

  console.log(`\n🔴 Needs Fix: ${Object.values(categories.needs_fix).flat().length}`);

  for (const [pattern, files] of Object.entries(categories.needs_fix)) {
    console.log(`\n   ${pattern}: ${files.length} files`);
    files.slice(0, 5).forEach(f => console.log(`      - ${f.file}`));
    if (files.length > 5) {
      console.log(`      ... and ${files.length - 5} more`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total violations: ${violations.length}`);
  console.log(`  False positives: ${categories.no_body_parsing.length}`);
  console.log(`  Already fixed: ${categories.already_fixed.length}`);
  console.log(`  Actually need fixing: ${Object.values(categories.needs_fix).flat().length}`);
  console.log('═'.repeat(70));

  // Save detailed report
  fs.writeFileSync(
    path.join(__dirname, '..', 'remaining-violations-analysis.json'),
    JSON.stringify({ categories, violations }, null, 2)
  );

  console.log('\n💾 Detailed report: remaining-violations-analysis.json');
}

main().catch(console.error);
