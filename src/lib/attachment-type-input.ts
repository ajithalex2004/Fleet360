/**
 * Validation of Attachment Type master input. POST needs code and name;
 * with `partial` (PATCH) only the fields present are returned.
 */

export interface AttachmentTypeInput {
  code: string;
  name: string;
  description?: string | null;
  isMandatory?: boolean;
  requiresExpiry?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export function attachmentTypeInput(
  body: unknown,
  opts: { partial: boolean },
): { ok: true; value: AttachmentTypeInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (b.code !== undefined || !opts.partial) {
    const code = typeof b.code === 'string' ? b.code.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) return { ok: false, error: 'Code must be 2–50 letters, digits or underscores, starting with a letter' };
    out.code = code;
  }
  if (b.name !== undefined || !opts.partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 100) return { ok: false, error: 'Name is required (at most 100 characters)' };
    out.name = name;
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== 'string') return { ok: false, error: 'Description must be text' };
    out.description = typeof b.description === 'string' ? b.description.trim() || null : null;
  }
  for (const k of ['isMandatory', 'requiresExpiry', 'isActive'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') return { ok: false, error: `${k} must be true or false` };
    out[k] = b[k];
  }
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder) || (b.sortOrder as number) < 0 || (b.sortOrder as number) > 10000) {
      return { ok: false, error: 'Sort order must be a whole number between 0 and 10000' };
    }
    out.sortOrder = b.sortOrder;
  }
  if (opts.partial && Object.keys(out).length === 0) return { ok: false, error: 'Nothing to update' };
  return { ok: true, value: out as unknown as AttachmentTypeInput };
}
