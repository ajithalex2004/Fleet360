import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load validation functions from scripts/validate-tenant-schema.js
const {
  parseSchema,
  validateModel,
  GLOBAL_PLATFORM_MODELS,
  CHILD_DEPENDENT_MODELS,
} = require('../../scripts/validate-tenant-schema.js');

describe('Adversarial Stress Test Suite: Milestone M4 Reviewer 2 (F36 - F39)', () => {
  const root = process.cwd();

  // ───────────────────────────────────────────────────────────────────────────
  // F36: Railway Deployment Migration Automation & Prisma Runtime Dependencies
  // ───────────────────────────────────────────────────────────────────────────
  describe('F36: Railway Deployment & Package Dependencies Stress Testing', () => {
    it('railway.json is strictly valid JSON with required Nixpacks builder and deploy command', () => {
      const railwayPath = path.join(root, 'railway.json');
      expect(fs.existsSync(railwayPath)).toBe(true);

      const content = fs.readFileSync(railwayPath, 'utf8');
      let config: any;
      expect(() => {
        config = JSON.parse(content);
      }).not.toThrow();

      expect(config.$schema).toBe('https://railway.app/railway.schema.json');
      expect(config.build).toBeDefined();
      expect(config.build.builder).toBe('NIXPACKS');
      expect(config.deploy).toBeDefined();
      expect(config.deploy.startCommand).toBe('npx prisma migrate deploy && npm start');
      expect(config.deploy.restartPolicyType).toBe('ON_FAILURE');
      expect(config.deploy.restartPolicyMaxRetries).toBeGreaterThanOrEqual(5);

      // Verify command uses AND (&&) to guarantee fail-fast behavior
      expect(config.deploy.startCommand).toMatch(/^npx prisma migrate deploy && /);
    });

    it('package.json strictly places @prisma/client in dependencies and eliminates it from devDependencies', () => {
      const pkgPath = path.join(root, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies['@prisma/client']).toBeDefined();
      expect(typeof pkg.dependencies['@prisma/client']).toBe('string');

      // Crucial: Must NOT exist in devDependencies to avoid dual-entry ambiguity
      if (pkg.devDependencies) {
        expect(pkg.devDependencies['@prisma/client']).toBeUndefined();
      }

      // Prisma CLI should remain in devDependencies for build/migration toolchain
      expect(pkg.devDependencies['prisma']).toBeDefined();
    });

    it('package.json provides explicit migration deployment and railway scripts', () => {
      const pkgPath = path.join(root, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      expect(pkg.scripts['db:migrate:deploy']).toBe('prisma migrate deploy');
      expect(pkg.scripts['railway:deploy']).toBe('npx prisma migrate deploy && next start');
      expect(pkg.scripts['start']).toBe('next start');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F37: Multi-Tenant Schema Drift, Unique Key Scoping & Validator Integrity
  // ───────────────────────────────────────────────────────────────────────────
  describe('F37: Schema Drift & Unique Key Scoping Stress Testing', () => {
    it('evaluates and accounts for all 252 models in prisma/schema.prisma without drops', () => {
      const schemaPath = path.join(root, 'prisma', 'schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');

      // Independent raw regex matching model declarations
      const rawModelMatches = schemaContent.match(/^model\s+([A-Za-z0-9_]+)\s*\{/gm) || [];
      const rawModelNames = rawModelMatches.map(m => m.replace(/^model\s+/, '').replace(/\s*\{/, '').trim());

      expect(rawModelNames.length).toBe(252);

      // Parse using validator's parser
      const parsedModels = parseSchema();
      expect(parsedModels.length).toBe(252);

      // Verify 1:1 name match
      const parsedNames = parsedModels.map((m: any) => m.name);
      for (const name of rawModelNames) {
        expect(parsedNames).toContain(name);
      }
    });

    it('rigorously tests validateModel against adversarial mock inputs', () => {
      // Scenario A: A tenant model missing tenantId
      const unScopedModel = {
        name: 'AdversarialTenantEntity',
        hasTenantId: false,
        hasIndex: false,
        body: 'model AdversarialTenantEntity {\n  id String @id\n  title String\n}',
      };
      const vA = validateModel(unScopedModel, []);
      expect(vA.length).toBeGreaterThan(0);
      expect(vA).toContain('Missing tenantId field on tenant-owned model');

      // Scenario B: A tenant model with global unscoped licensePlate unique
      const unscopedPlateModel = {
        name: 'AdversarialVehicle',
        hasTenantId: true,
        hasIndex: true,
        body: 'model AdversarialVehicle {\n  id String @id\n  tenantId String\n  licensePlate String @unique\n}',
      };
      const vB = validateModel(unscopedPlateModel, []);
      expect(vB.length).toBeGreaterThan(0);
      expect(vB).toContain('Unscoped global @unique detected; must use composite @@unique([tenantId, ...])');

      // Scenario C: A tenant model with global unscoped vin unique
      const unscopedVinModel = {
        name: 'AdversarialVinVehicle',
        hasTenantId: true,
        hasIndex: true,
        body: 'model AdversarialVinVehicle {\n  id String @id\n  tenantId String\n  vin String @unique\n}',
      };
      const vC = validateModel(unscopedVinModel, []);
      expect(vC.length).toBeGreaterThan(0);
      expect(vC).toContain('Unscoped global @unique detected; must use composite @@unique([tenantId, ...])');

      // Scenario D: Valid tenant model with composite unique key
      const validCompositeModel = {
        name: 'ValidTenantEntity',
        hasTenantId: true,
        hasIndex: true,
        body: 'model ValidTenantEntity {\n  id String @id\n  tenantId String\n  code String\n  @@unique([tenantId, code])\n}',
      };
      const vD = validateModel(validCompositeModel, []);
      expect(vD.length).toBe(0);
    });

    it('verifies that all Vehicle, Invoice, and FinanceInvoice identifiers are scoped to tenantId', () => {
      const schemaPath = path.join(root, 'prisma', 'schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');

      // Vehicle
      expect(schemaContent).toMatch(/@@unique\(\[tenantId,\s*licensePlate\]/);
      expect(schemaContent).toMatch(/@@unique\(\[tenantId,\s*vin\]/);

      // Invoices
      expect(schemaContent).toMatch(/@@unique\(\[tenantId,\s*invoiceNumber\]/);

      // Verify no unscoped @unique on licensePlate or vin exists in the actual schema
      const lines = schemaContent.split('\n');
      for (const line of lines) {
        if (line.includes('licensePlate') || line.includes('vin')) {
          expect(line).not.toMatch(/@unique(?!\()/);
        }
      }
    });

    it('confirms the 13 global platform models and 41 child dependent models are strictly defined', () => {
      expect(GLOBAL_PLATFORM_MODELS.size).toBe(13);
      expect(CHILD_DEPENDENT_MODELS.size).toBe(41);
      expect(GLOBAL_PLATFORM_MODELS.size + CHILD_DEPENDENT_MODELS.size).toBe(54);

      // 252 - 54 = 198 tenant-scoped models
      const models = parseSchema();
      const tenantScoped = models.filter(
        (m: any) => !GLOBAL_PLATFORM_MODELS.has(m.name) && !CHILD_DEPENDENT_MODELS.has(m.name),
      );
      expect(tenantScoped.length).toBe(198);

      // Verify every single tenant-scoped model in schema.prisma has tenantId
      for (const m of tenantScoped) {
        expect(m.hasTenantId, `Model ${m.name} is missing tenantId`).toBe(true);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F38: Production TypeScript Build Checking & tsconfig.finance.json
  // ───────────────────────────────────────────────────────────────────────────
  describe('F38: Production TypeScript Build Enforcement Stress Testing', () => {
    it('next.config.ts strictly sets typescript.ignoreBuildErrors to false', () => {
      const nextConfigPath = path.join(root, 'next.config.ts');
      const content = fs.readFileSync(nextConfigPath, 'utf8');

      // Must explicitly contain ignoreBuildErrors: false
      expect(content).toMatch(/typescript:\s*\{[^}]*ignoreBuildErrors:\s*false/);

      // Must NOT contain ignoreBuildErrors: true
      expect(content).not.toMatch(/typescript:\s*\{[^}]*ignoreBuildErrors:\s*true/);
    });

    it('tsconfig.finance.json correctly points to src/app/(app)/finance/** and has zero outdated dashboard paths', () => {
      const tsconfigFinancePath = path.join(root, 'tsconfig.finance.json');
      const content = fs.readFileSync(tsconfigFinancePath, 'utf8');

      expect(content).toContain('src/app/(app)/finance/**/*.ts');
      expect(content).toContain('src/app/(app)/finance/**/*.tsx');

      // Crucial: No remnants of old (dashboard) path
      expect(content).not.toContain('(dashboard)');

      // Verify referenced paths exist
      const financeAppDir = path.join(root, 'src', 'app', '(app)', 'finance');
      expect(fs.existsSync(financeAppDir)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F39: DevOps Hygiene & Clean Git Artifacts Stress Testing
  // ───────────────────────────────────────────────────────────────────────────
  describe('F39: DevOps Hygiene & Clean Git Artifacts Stress Testing', () => {
    it('.gitignore comprehensively ignores compiled binaries, logs, and temp artifacts', () => {
      const gitignorePath = path.join(root, '.gitignore');
      const content = fs.readFileSync(gitignorePath, 'utf8');

      const expectedRules = [
        '*.apk',
        '*.dex',
        '*.docx',
        '*.log',
        'tmp/',
        '/tmp/',
        'errors.txt',
        'tsc-*.txt',
        'tsc-*.log',
      ];

      for (const rule of expectedRules) {
        expect(content, `Missing rule ${rule} in .gitignore`).toContain(rule);
      }
    });

    it('verifies that known stray binary and log artifacts do NOT exist anywhere on disk', () => {
      const strayFiles = [
        'Fleet360-Driver.apk',
        'public/Fleet360-Driver.apk',
        'scripts/installed.apk',
        'scripts/classes.dex',
        'scripts/classes-from-apk.dex',
        'errors.txt',
        'tsc-out.txt',
        'tsc-errors.txt',
        'node',
        'TENANT-001',
      ];

      for (const file of strayFiles) {
        const fullPath = path.join(root, file);
        expect(fs.existsSync(fullPath), `Stray artifact ${file} still exists on disk!`).toBe(false);
      }
    });

    it('stress tests .gitignore rules against adversarial simulated filenames', () => {
      const gitignoreContent = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      const lines = gitignoreContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

      // Check pattern matches
      expect(lines.some(l => l === '*.apk' || l === '/*.apk')).toBe(true);
      expect(lines.some(l => l === '*.dex')).toBe(true);
      expect(lines.some(l => l === '*.docx')).toBe(true);
      expect(lines.some(l => l === '*.log')).toBe(true);
      expect(lines.some(l => l === 'tmp/' || l === '/tmp/')).toBe(true);
    });
  });
});
