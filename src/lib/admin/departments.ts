/**
 * Department master (Admin > Departments): input rules shared by the
 * /api/admin/departments routes.
 */

export interface DepartmentFields {
  name?: string;
  code?: string | null;
  isActive?: boolean;
}

export function departmentInput(
  body: unknown,
  opts: { requireName: boolean },
): { ok: true; value: DepartmentFields } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const value: DepartmentFields = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'Department name is required' };
    if (b.name.trim().length > 120) return { ok: false, error: 'Department name is too long (120 characters at most)' };
    value.name = b.name.trim();
  } else if (opts.requireName) {
    return { ok: false, error: 'Department name is required' };
  }
  if (b.code !== undefined) {
    if (b.code !== null && typeof b.code !== 'string') return { ok: false, error: 'Code must be text' };
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    if (code.length > 40) return { ok: false, error: 'Code is too long (40 characters at most)' };
    value.code = code || null;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') return { ok: false, error: 'isActive must be true or false' };
    value.isActive = b.isActive;
  }
  return { ok: true, value };
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
