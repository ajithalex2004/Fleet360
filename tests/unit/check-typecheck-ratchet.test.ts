import { describe, it, expect } from 'vitest';
import {
  normalizeMessage,
  parseDiagnostics,
  compareDiagnostics,
} from '../../scripts/check-typecheck-ratchet.mjs';

describe('Typecheck Ratchet diagnostic fingerprinting & safety', () => {
  it('normalizes error messages by collapsing multiple spaces and trimming', () => {
    const raw = "  Type   'string' is  not \n assignable to   type 'number'.  ";
    expect(normalizeMessage(raw)).toBe("Type 'string' is not assignable to type 'number'.");
  });

  it('normalizes platform-dependent anonymous structural types and missing property lists consistently', () => {
    const winMsg = "Property 'passengers' does not exist on type '{ tenantId: string; id: string; createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null; status: string | null; templateId: string | null; notes: string | null; ... 14 more ...; }'.";
    const linMsg = "Property 'passengers' does not exist on type '{ tenantId: string; status: string | null; id: string; createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null; notes: string | null; vehicleId: string | null; ... 14 more ...; }'.";

    expect(normalizeMessage(winMsg)).toBe("Property 'passengers' does not exist on type '{...}'.");
    expect(normalizeMessage(linMsg)).toBe("Property 'passengers' does not exist on type '{...}'.");
    expect(normalizeMessage(winMsg)).toBe(normalizeMessage(linMsg));

    const winReg = "Type '{...}' is missing the following properties from type 'Record<AgentId, () => Promise<AgentDefinition>>': \"quotation-copilot\", \"rental-copilot\", \"damage-classifier\", \"doc-classifier\", and 2 more.";
    const linReg = "Type '{...}' is missing the following properties from type 'Record<AgentId, () => Promise<AgentDefinition>>': \"chat-widget\", \"quotation-copilot\", \"rental-copilot\", \"damage-classifier\", and 2 more.";
    expect(normalizeMessage(winReg)).toBe("Type '{...}' is missing properties from type 'Record<AgentId, () => Promise<AgentDefinition>>'");
    expect(normalizeMessage(linReg)).toBe("Type '{...}' is missing properties from type 'Record<AgentId, () => Promise<AgentDefinition>>'");
    expect(normalizeMessage(winReg)).toBe(normalizeMessage(linReg));
  });

  it('parses diagnostics and generates stable fingerprints without line numbers', () => {
    const tscOutput = [
      "src/app/page.tsx(42,15): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/app/page.tsx(100,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/app/page.tsx(120,8): error TS2345: Argument of type 'null' is not assignable to parameter of type 'string'.",
      ".next/types/app/page.ts(1,1): error TS2307: Cannot find module 'foo'.", // should be ignored (.next)
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

  it('parses global compiler errors', () => {
    const tscOutput = 'error TS5083: Cannot read file tsconfig.json.';
    const { globalErrors } = parseDiagnostics(tscOutput);
    expect(globalErrors).toContain('error TS5083: Cannot read file tsconfig.json.');
  });

  it('rejects a file not present in baseline', () => {
    const current = new Map([
      ['src/new-file.ts', { total: 1, codes: { TS2307: 1 }, fingerprints: { 'TS2307:Cannot find module': 1 } }],
    ]);
    const baseline = { files: {} };

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

  it('catches and rejects a NEW diagnostic fingerprint even if code count and total count match baseline', () => {
    // SCENARIO: A file previously had 1 TS2322 error: "Type 'string' is not assignable to type 'number'".
    // A developer "fixes" it, but introduces a DIFFERENT TS2322 error: "Type 'boolean' is not assignable to type 'number'".
    // Total count is still 1. Code count for TS2322 is still 1.
    // BUT the diagnostic fingerprint changed!
    const current = new Map([
      ['src/app/page.tsx', {
        total: 1,
        codes: { TS2322: 1 },
        fingerprints: { "TS2322:Type 'boolean' is not assignable to type 'number'.": 1 },
      }],
    ]);
    const baseline = {
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

  it('catches fingerprint multiplicity increase (e.g. same error occurring 2 times instead of 1)', () => {
    const current = new Map([
      ['src/app/page.tsx', {
        total: 2,
        codes: { TS2322: 2 },
        fingerprints: { "TS2322:Type 'string' is not assignable": 2 },
      }],
    ]);
    const baseline = {
      files: {
        'src/app/page.tsx': {
          total: 2, // baseline allowed total 2
          codes: { TS2322: 2 }, // baseline allowed code TS2322 count 2
          fingerprints: {
            "TS2322:Type 'string' is not assignable": 1, // but this specific message only allowed 1
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

    const { violations, cleanFiles } = compareDiagnostics(current, baseline);
    expect(violations).toHaveLength(0);
    expect(cleanFiles).toContain('src/app/now-clean.tsx');
  });
});
