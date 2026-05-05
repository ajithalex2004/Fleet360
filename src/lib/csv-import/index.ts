/**
 * CSV import — parse + Zod-validate + preview / commit pattern.
 *
 * Two-step UX:
 *   1. POST with mode=preview → returns parsed rows, header detection, and
 *      per-row validation errors. Frontend shows the preview; user fixes
 *      problems in the source file and re-uploads.
 *   2. POST with mode=commit → re-parses, drops invalid rows, inserts the
 *      valid ones in a single transaction. Returns inserted/skipped counts.
 *
 * Trim, case-fold, and synonym-resolve headers so STS can use whatever
 * column names their source spreadsheet has — within reason. Unknown
 * columns are reported as warnings but don't block the import.
 */

import Papa from 'papaparse';
import type { z, ZodTypeAny } from 'zod';

export type ImportMode = 'preview' | 'commit';

export interface RowError {
  row: number; // 1-based row number in the source file (excluding header)
  path: string;
  message: string;
}

export interface ImportPreview<T> {
  mode: 'preview';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  detectedHeaders: string[];
  unknownHeaders: string[];
  rows: Array<{
    row: number;
    raw: Record<string, string>;
    parsed?: T;
    errors: RowError[];
  }>;
  errors: RowError[]; // file-level errors (parsing, etc.)
}

export interface ImportResult {
  mode: 'commit';
  inserted: number;
  skipped: number;
  errors: RowError[];
}

export interface ImportConfig<T> {
  schema: z.ZodType<T>;
  /** Column-name synonyms. Keys are canonical schema field names; values are
   *  lowercase aliases the user might have in their CSV. */
  headerAliases?: Record<string, string[]>;
  /** Optional row pre-processor — e.g. trim, coerce blanks to undefined. */
  preprocess?: (raw: Record<string, string>) => Record<string, unknown>;
}

/** Lowercase, strip non-alphanumerics for header matching. */
function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Build a header → canonical field map from aliases. */
function buildHeaderMap<T>(headers: string[], cfg: ImportConfig<T>): Map<string, string> {
  const map = new Map<string, string>();
  const aliases = cfg.headerAliases ?? {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    let canonical = header.trim();
    for (const [field, list] of Object.entries(aliases)) {
      if (list.some(a => normalizeHeader(a) === norm) || normalizeHeader(field) === norm) {
        canonical = field;
        break;
      }
    }
    map.set(header, canonical);
  }
  return map;
}

/** Default preprocessor: trim strings, blank → undefined, "true"/"false" → boolean. */
function defaultPreprocess(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const trimmed = typeof v === 'string' ? v.trim() : v;
    if (trimmed === '' || trimmed == null) {
      out[k] = undefined;
    } else if (trimmed === 'true' || trimmed === 'TRUE') {
      out[k] = true;
    } else if (trimmed === 'false' || trimmed === 'FALSE') {
      out[k] = false;
    } else {
      out[k] = trimmed;
    }
  }
  return out;
}

export function parseCsv<T>(
  csvText: string,
  cfg: ImportConfig<T>,
): ImportPreview<T> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false, // we coerce in zod
  });

  const fileErrors: RowError[] = parsed.errors.map(e => ({
    row: (e.row ?? 0) + 1,
    path: '_file',
    message: e.message,
  }));

  const detectedHeaders = parsed.meta.fields ?? [];
  const headerMap = buildHeaderMap(detectedHeaders, cfg);
  const knownFields = new Set(headerMap.values());
  const schemaShape = (cfg.schema as any)._def?.schema?.shape ?? (cfg.schema as any)._def?.shape;
  const schemaFields = schemaShape ? Object.keys(schemaShape) : [];

  // Headers we couldn't map to any schema field (warn, don't fail).
  const unknownHeaders = detectedHeaders.filter(h => {
    const canonical = headerMap.get(h);
    return canonical && schemaFields.length > 0 && !schemaFields.includes(canonical);
  });

  const preprocess = cfg.preprocess ?? defaultPreprocess;
  const rows = (parsed.data ?? []).map((raw, idx) => {
    const rowNum = idx + 2; // +1 for 1-based, +1 for header row
    // Re-key by canonical names
    const renamed: Record<string, string> = {};
    for (const [orig, val] of Object.entries(raw)) {
      const canon = headerMap.get(orig) ?? orig;
      renamed[canon] = val;
    }
    const preprocessed = preprocess(renamed);
    const result = cfg.schema.safeParse(preprocessed);
    if (result.success) {
      return { row: rowNum, raw, parsed: result.data as T, errors: [] };
    }
    return {
      row: rowNum,
      raw,
      errors: result.error.issues.map(i => ({
        row: rowNum,
        path: i.path.join('.') || '_row',
        message: i.message,
      })),
    };
  });

  return {
    mode: 'preview',
    totalRows: rows.length,
    validRows: rows.filter(r => r.errors.length === 0).length,
    invalidRows: rows.filter(r => r.errors.length > 0).length,
    detectedHeaders,
    unknownHeaders,
    rows,
    errors: fileErrors,
  };
}

/**
 * Run the schema check, then call the inserter for each valid row.
 * The inserter is given the validated parsed object; failures are collected.
 */
export async function commitCsvRows<T>(
  csvText: string,
  cfg: ImportConfig<T>,
  insertOne: (row: T) => Promise<void>,
): Promise<ImportResult> {
  const preview = parseCsv(csvText, cfg);
  let inserted = 0;
  const errors: RowError[] = [...preview.errors];

  for (const row of preview.rows) {
    if (row.errors.length > 0) {
      errors.push(...row.errors);
      continue;
    }
    try {
      await insertOne(row.parsed!);
      inserted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: row.row, path: '_insert', message: msg });
    }
  }

  return {
    mode: 'commit',
    inserted,
    skipped: preview.totalRows - inserted,
    errors,
  };
}
