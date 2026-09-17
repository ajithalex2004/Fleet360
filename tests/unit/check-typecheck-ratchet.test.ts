import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  normalizeMessage,
  sortTypeProperties,
  isCompilerCrash,
  parseDiagnostics,
  compareDiagnostics,
  runRatchetGate,
  verifyDependencyPreflight,
  validateBaselineStructure,
  loadBaseline,
} from '../../scripts/check-typecheck-ratchet.mjs';

describe('Typecheck Ratchet diagnostic fingerprinting & safety', () => {
  describe('normalizeMessage & string determinism', () => {
    it('normalizes error messages by collapsing multiple spaces and trimming', () => {
      const raw = "  Type   'string' is  not \n assignable to   type 'number'.  ";
      expect(normalizeMessage(raw)).toBe("Type 'string' is not assignable to type 'number'.");
    });

    it('terminates and does not hang when normalizing complex structural types (tested in isolated subprocess with strict 3s timeout)', () => {
      const scriptPath = join(process.cwd(), 'scripts', 'check-typecheck-ratchet.mjs');
      const input = "Property 'passengers' does not exist on type '{ tenantId: string; id: string; createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null; status: string | null; templateId: string | null; notes: string | null; ... 14 more ...; }'.";

      const nodeCode = `
        import { normalizeMessage } from ${JSON.stringify(pathToFileURL(scriptPath).href)};
        const res = normalizeMessage(${JSON.stringify(input)});
        if (!res) process.exit(2);
        process.exit(0);
      `;

      const start = Date.now();
      execFileSync(process.execPath, ['--input-type=module', '-e', nodeCode], {
        timeout: 3000,
        stdio: 'pipe',
      });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2500);
    });

    it('preserves meaningful structural type differences instead of collapsing every type into the same string', () => {
      const typeA = "Type '{ id: string; name: string; }' is not assignable to type 'Foo'.";
      const typeB = "Type '{ active: boolean; id: number; }' is not assignable to type 'Foo'.";
      const normA = normalizeMessage(typeA);
      const normB = normalizeMessage(typeB);

      expect(normA).not.toBe(normB);
      expect(normA).toContain('name: string');
      expect(normA).toContain('id: string');
      expect(normB).toContain('active: boolean');
      expect(normB).toContain('id: number');
    });

    it('normalizes platform-dependent property ordering deterministically for concrete types', () => {
      const orderA = "Type '{ id: string; name: string; age: number; }' is not assignable to type 'Foo'.";
      const orderB = "Type '{ name: string; age: number; id: string; }' is not assignable to type 'Foo'.";

      const normA = normalizeMessage(orderA);
      const normB = normalizeMessage(orderB);

      expect(normA).toBe(normB);
      expect(normA).toBe("Type '{ age: number; id: string; name: string; }' is not assignable to type 'Foo'.");
    });

    it('normalizes truncated structural types with ellipsis to ensure cross-platform reproducibility', () => {
      const winMsg = "Property 'passengers' does not exist on type '{ tenantId: string; id: string; createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null; status: string | null; templateId: string | null; notes: string | null; ... 14 more ...; }'.";
      const linMsg = "Property 'passengers' does not exist on type '{ tenantId: string; status: string | null; id: string; createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null; notes: string | null; vehicleId: string | null; ... 14 more ...; }'.";

      const normWin = normalizeMessage(winMsg);
      const normLin = normalizeMessage(linMsg);

      expect(normWin).toBe(normLin);
      expect(normWin).toBe("Property 'passengers' does not exist on type '{...}'.");
    });

    it('normalizes missing properties lists across platform iteration orders deterministically', () => {
      const order1 = "Type '{...}' is missing the following properties from type 'Record<AgentId, () => Promise<AgentDefinition>>': \"quotation-copilot\", \"rental-copilot\", \"damage-classifier\", and 2 more.";
      const order2 = "Type '{...}' is missing the following properties from type 'Record<AgentId, () => Promise<AgentDefinition>>': \"rental-copilot\", \"quotation-copilot\", \"damage-classifier\", and 2 more.";

      const norm1 = normalizeMessage(order1);
      const norm2 = normalizeMessage(order2);

      expect(norm1).toBe(norm2);
      expect(norm1).toBe("Type '{...}' is missing properties [damage-classifier, quotation-copilot, rental-copilot] from type 'Record<AgentId, () => Promise<AgentDefinition>>'.");
    });

    it('preserves semantic detail in missing properties lists and resists collision between different missing sets', () => {
      const errA = "Type 'Payload' is missing the following properties from type 'Config': id, name";
      const errB = "Type 'Payload' is missing the following properties from type 'Config': tenantId, currency";

      const normA = normalizeMessage(errA);
      const normB = normalizeMessage(errB);

      expect(normA).not.toBe(normB);
      expect(normA).toBe("Type 'Payload' is missing properties [id, name] from type 'Config'");
      expect(normB).toBe("Type 'Payload' is missing properties [currency, tenantId] from type 'Config'");
    });

    it('normalizes string literal union types across platform compiler iteration orders', () => {
      const u1 = 'Property reason does not exist on type { action?: "REJECT" | "APPLY" | undefined; }';
      const u2 = 'Property reason does not exist on type { action?: "APPLY" | "REJECT" | undefined; }';
      expect(normalizeMessage(u1)).toBe(normalizeMessage(u2));
      expect(normalizeMessage(u1)).toBe('Property reason does not exist on type { action?: "APPLY" | "REJECT" | undefined; }');

      const p1 = 'Type "INVOICE" | "WORK_ORDER" | "DRIVER" | "NONE" | "VEHICLE" | "PARTNER" is not assignable';
      const p2 = 'Type "NONE" | "DRIVER" | "VEHICLE" | "INVOICE" | "WORK_ORDER" | "PARTNER" is not assignable';
      expect(normalizeMessage(p1)).toBe(normalizeMessage(p2));
      expect(normalizeMessage(p1)).toBe('Type "DRIVER" | "INVOICE" | "NONE" | "PARTNER" | "VEHICLE" | "WORK_ORDER" is not assignable');
    });
  });

  describe('verifyDependencyPreflight', () => {
    it('succeeds in a healthy project environment', () => {
      const res = verifyDependencyPreflight();
      expect(res.valid).toBe(true);
      expect(res.error).toBeNull();
    });

    it('fails when critical dependencies are missing or incomplete in node_modules', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'fleet-preflight-test-'));
      try {
        const fakeNodeModules = join(tmpDir, 'node_modules');
        mkdirSync(join(fakeNodeModules, 'typescript'), { recursive: true });
        writeFileSync(join(fakeNodeModules, 'typescript', 'package.json'), '{}');

        // next and @prisma/client are missing
        const res = verifyDependencyPreflight(tmpDir);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Missing or incomplete core dependencies');
        expect(res.error).toContain('next');
        expect(res.error).toContain('@prisma/client');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('isCompilerCrash & crash detection', () => {
    it('identifies compiler crashes and abnormal exits correctly (exit 137, SIGKILL, SIGSEGV, OOM)', () => {
      expect(isCompilerCrash({ exitCode: 137, signal: null, output: '' })).toBe(true);
      expect(isCompilerCrash({ exitCode: 139, signal: null, output: '' })).toBe(true);
      expect(isCompilerCrash({ exitCode: 1, signal: 'SIGKILL', output: '' })).toBe(true);
      expect(isCompilerCrash({ exitCode: 1, signal: null, output: 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory' })).toBe(true);
      expect(isCompilerCrash({ exitCode: 1, signal: null, output: 'Internal compiler error at checker.ts:123' })).toBe(true);
      expect(isCompilerCrash({ exitCode: 1, signal: null, output: '', error: { code: 'ENOBUFS' } })).toBe(true);

      // Normal TypeScript error exit codes (1 or 2) without crash indicators are NOT crashes
      expect(isCompilerCrash({ exitCode: 1, signal: null, output: 'src/app/page.tsx(1,1): error TS2322: ...' })).toBe(false);
      expect(isCompilerCrash({ exitCode: 2, signal: null, output: 'src/app/page.tsx(1,1): error TS2322: ...' })).toBe(false);
      expect(isCompilerCrash({ exitCode: 0, signal: null, output: '' })).toBe(false);
    });

    it('fails closed when compiler crashes EVEN IF partial diagnostics were emitted before crashing', () => {
      const partialOutput = "src/app/page.tsx(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
      const crashedTscResult = {
        exitCode: 137,
        signal: 'SIGKILL',
        output: partialOutput,
      };

      expect(() => {
        runRatchetGate({
          tscResult: crashedTscResult,
          throwOnError: true,
        });
      }).toThrow(/TypeScript compiler crashed or terminated abnormally/);
    });
  });

  describe('parseDiagnostics & multi-line accumulation', () => {
    it('parses diagnostics and generates stable fingerprints without line numbers', () => {
      const tscOutput = [
        "src/app/page.tsx(42,15): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/app/page.tsx(100,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/app/page.tsx(120,8): error TS2345: Argument of type 'null' is not assignable to parameter of type 'string'.",
      ].join('\n');

      const { fileDiagnostics, globalErrors } = parseDiagnostics(tscOutput);
      expect(globalErrors).toHaveLength(0);
      expect(fileDiagnostics.size).toBe(1);
      expect(fileDiagnostics.has('src/app/page.tsx')).toBe(true);

      const entry = fileDiagnostics.get('src/app/page.tsx')!;
      expect(entry.total).toBe(3);
      expect(entry.codes['TS2322']).toBe(2);
      expect(entry.codes['TS2345']).toBe(1);

      // Fingerprint includes code + normalized message, but NOT line numbers
      const fp1 = "TS2322:Type 'string' is not assignable to type 'number'.";
      const fp2 = "TS2345:Argument of type 'null' is not assignable to parameter of type 'string'.";
      expect(entry.fingerprints[fp1]).toBe(2);
      expect(entry.fingerprints[fp2]).toBe(1);
    });

    it('accumulates multi-line continuation lines into a complete diagnostic chain fingerprint', () => {
      const tscOutput = [
        "src/app/api/orders/route.ts(15,3): error TS2322: Type 'Input' is not assignable to type 'Output'.",
        "  Types of property 'amount' are incompatible.",
        "    Type 'string' is not assignable to type 'number'.",
      ].join('\n');

      const { fileDiagnostics } = parseDiagnostics(tscOutput);
      expect(fileDiagnostics.size).toBe(1);
      const entry = fileDiagnostics.get('src/app/api/orders/route.ts')!;
      expect(entry.total).toBe(1);

      const expectedFp = [
        "TS2322:Type 'Input' is not assignable to type 'Output'.",
        "Types of property 'amount' are incompatible.",
        "Type 'string' is not assignable to type 'number'.",
      ].join('\n');

      expect(entry.fingerprints[expectedFp]).toBe(1);
    });

    it('tracks generated route types under .next/types/validator.ts and does not silently ignore them', () => {
      const tscOutput = [
        ".next/types/validator.ts(10,5): error TS2344: Type 'typeof import(\"./route\")' does not satisfy constraint 'RouteHandlerConfig'.",
        "  Types of property 'POST' are incompatible.",
      ].join('\n');

      const { fileDiagnostics } = parseDiagnostics(tscOutput);
      expect(fileDiagnostics.has('.next/types/validator.ts')).toBe(true);
      const entry = fileDiagnostics.get('.next/types/validator.ts')!;
      expect(entry.total).toBe(1);
      expect(entry.codes['TS2344']).toBe(1);
    });

    it('parses global compiler errors', () => {
      const tscOutput = 'error TS5083: Cannot read file tsconfig.json.';
      const { globalErrors } = parseDiagnostics(tscOutput);
      expect(globalErrors).toContain('error TS5083: Cannot read file tsconfig.json.');
    });

    it('fails closed when global compiler errors exist', () => {
      const tscOutput = 'error TS18003: No inputs were found in config file.';
      expect(() => {
        runRatchetGate({
          tscResult: { exitCode: 1, signal: null, output: tscOutput },
          throwOnError: true,
        });
      }).toThrow(/Global TypeScript compiler errors detected/);
    });
  });

  describe('validateBaselineStructure (schemaVersion: 2 integrity)', () => {
    it('accepts a valid schemaVersion: 2 baseline where codes and fingerprints sums match totals', () => {
      const validBaseline = {
        schemaVersion: 2,
        totalErrors: 3,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 3,
            codes: { TS2322: 2, TS2345: 1 },
            fingerprints: {
              'TS2322:Type string is not assignable to number': 2,
              'TS2345:Argument null not assignable': 1,
            },
          },
        },
      };

      expect(validateBaselineStructure(validBaseline)).toBe(true);
    });

    it('rejects an unversioned baseline or unsupported schemaVersion', () => {
      const unversioned = {
        totalErrors: 1,
        totalFiles: 1,
        files: { 'src/app/page.tsx': { total: 1, codes: { TS2322: 1 }, fingerprints: { 'TS2322:foo': 1 } } },
      };
      expect(() => validateBaselineStructure(unversioned)).toThrow(/Incompatible baseline schema version/);

      const v1Baseline = { ...unversioned, schemaVersion: 1 };
      expect(() => validateBaselineStructure(v1Baseline)).toThrow(/Expected schemaVersion: 2/);
    });

    it('rejects a baseline where sum of codes does not equal file total', () => {
      const malformed = {
        schemaVersion: 2,
        totalErrors: 2,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 2,
            codes: { TS2322: 1 }, // sum is 1, but total is 2
            fingerprints: { 'TS2322:foo': 2 },
          },
        },
      };
      expect(() => validateBaselineStructure(malformed)).toThrow(/sum of error codes \(1\) does not match total \(2\)/);
    });

    it('rejects a baseline where sum of fingerprints does not equal file total', () => {
      const malformed = {
        schemaVersion: 2,
        totalErrors: 2,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 2,
            codes: { TS2322: 2 },
            fingerprints: { 'TS2322:foo': 1 }, // sum is 1, but total is 2
          },
        },
      };
      expect(() => validateBaselineStructure(malformed)).toThrow(/sum of fingerprints \(1\) does not match total \(2\)/);
    });

    it('rejects a baseline with empty codes or fingerprints map', () => {
      const emptyCodes = {
        schemaVersion: 2,
        totalErrors: 1,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 1,
            codes: {},
            fingerprints: { 'TS2322:foo': 1 },
          },
        },
      };
      expect(() => validateBaselineStructure(emptyCodes)).toThrow(/codes map must be non-empty/);
    });

    it('rejects a baseline where file totals do not sum to totalErrors', () => {
      const mismatch = {
        schemaVersion: 2,
        totalErrors: 10, // claims 10, but file only has 1
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 1,
            codes: { TS2322: 1 },
            fingerprints: { 'TS2322:foo': 1 },
          },
        },
      };
      expect(() => validateBaselineStructure(mismatch)).toThrow(/sum of file errors \(1\) does not match totalErrors \(10\)/);
    });
  });

  describe('compareDiagnostics enforcement', () => {
    it('rejects a file not present in baseline', () => {
      const current = new Map([
        ['src/new-file.ts', { total: 1, codes: { TS2307: 1 }, fingerprints: { 'TS2307:Cannot find module': 1 } }],
      ]);
      const baseline = { schemaVersion: 2, totalErrors: 0, totalFiles: 0, files: {} };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.some(v => v.includes('[NEW FILE] src/new-file.ts'))).toBe(true);
    });

    it('rejects an increased error count in an allowed file', () => {
      const current = new Map([
        ['src/app/page.tsx', {
          total: 2,
          codes: { TS2322: 2 },
          fingerprints: { "TS2322:Type 'string' is not assignable": 2 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 1,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 1,
            codes: { TS2322: 1 },
            fingerprints: { "TS2322:Type 'string' is not assignable": 1 },
          },
        },
      };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.some(v => v.includes('[COUNT INCREASE] src/app/page.tsx'))).toBe(true);
    });

    it('rejects a new or increased error code count even if total count is under baseline', () => {
      const current = new Map([
        ['src/app/page.tsx', {
          total: 1,
          codes: { TS2345: 1 }, // TS2345 was never in baseline
          fingerprints: { "TS2345:Argument null not assignable": 1 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 1,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 1,
            codes: { TS2322: 1 },
            fingerprints: { "TS2322:Type 'string' is not assignable": 1 },
          },
        },
      };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.some(v => v.includes('[NEW/INCREASED CODE] src/app/page.tsx: code TS2345'))).toBe(true);
    });

    it('catches and rejects a NEW diagnostic fingerprint even if code count and total count match baseline', () => {
      const current = new Map([
        ['src/app/page.tsx', {
          total: 1,
          codes: { TS2322: 1 },
          fingerprints: { "TS2322:Type 'boolean' is not assignable to type 'number'.": 1 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 1,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 1,
            codes: { TS2322: 1 },
            fingerprints: { "TS2322:Type 'string' is not assignable to type 'number'.": 1 },
          },
        },
      };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.includes('[NEW/INCREASED FINGERPRINT] src/app/page.tsx'))).toBe(true);
      expect(violations.some(v => v.includes("Type 'boolean' is not assignable"))).toBe(true);
    });

    it('catches sub-reason changes in multi-line continuation line chains', () => {
      const baselineChain = [
        "TS2322:Type 'Input' is not assignable to type 'Output'.",
        "Types of property 'amount' are incompatible.",
        "Type 'string' is not assignable to type 'number'.",
      ].join('\n');

      const alteredSubReasonChain = [
        "TS2322:Type 'Input' is not assignable to type 'Output'.",
        "Types of property 'tenantId' are incompatible.", // sub-reason changed!
        "Type 'string' is not assignable to type 'number'.",
      ].join('\n');

      const current = new Map([
        ['src/app/api/orders/route.ts', {
          total: 1,
          codes: { TS2322: 1 },
          fingerprints: { [alteredSubReasonChain]: 1 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 1,
        totalFiles: 1,
        files: {
          'src/app/api/orders/route.ts': {
            total: 1,
            codes: { TS2322: 1 },
            fingerprints: { [baselineChain]: 1 },
          },
        },
      };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.some(v => v.includes('[NEW/INCREASED FINGERPRINT]'))).toBe(true);
      expect(violations.some(v => v.includes("Types of property 'tenantId' are incompatible"))).toBe(true);
    });

    it('catches fingerprint multiplicity increase (e.g. same error occurring 2 times instead of 1)', () => {
      const current = new Map([
        ['src/app/page.tsx', {
          total: 2,
          codes: { TS2322: 2 },
          fingerprints: { "TS2322:Type 'string' is not assignable": 2 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 2,
        totalFiles: 1,
        files: {
          'src/app/page.tsx': {
            total: 2,
            codes: { TS2322: 2 },
            fingerprints: {
              "TS2322:Type 'string' is not assignable": 1,
              "TS2322:Other message": 1,
            },
          },
        },
      };

      const { violations } = compareDiagnostics(current, baseline);
      expect(violations.some(v => v.includes('[NEW/INCREASED FINGERPRINT]'))).toBe(true);
    });

    it('passes cleanly when current diagnostics match baseline exactly or have decreased', () => {
      const current = new Map([
        ['src/app/page.tsx', {
          total: 1,
          codes: { TS2322: 1 },
          fingerprints: { "TS2322:Type 'string' is not assignable": 1 },
        }],
      ]);
      const baseline = {
        schemaVersion: 2,
        totalErrors: 3,
        totalFiles: 2,
        files: {
          'src/app/page.tsx': {
            total: 2,
            codes: { TS2322: 2 },
            fingerprints: {
              "TS2322:Type 'string' is not assignable": 1,
              "TS2322:Some resolved error": 1,
            },
          },
          'src/app/now-clean.tsx': {
            total: 1,
            codes: { TS2307: 1 },
            fingerprints: { "TS2307:Cannot find module": 1 },
          },
        },
      };

      const { violations, cleanFiles, reducedFiles } = compareDiagnostics(current, baseline);
      expect(violations).toHaveLength(0);
      expect(cleanFiles).toContain('src/app/now-clean.tsx');
      expect(reducedFiles).toHaveLength(1);
      expect(reducedFiles[0]).toEqual({
        file: 'src/app/page.tsx',
        before: 2,
        after: 1,
      });
    });
  });
});
