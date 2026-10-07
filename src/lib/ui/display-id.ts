/**
 * How records are identified on screen: by their human code (tenant code,
 * work order number, plate, …). The internal ID (a UUID) is shown only when
 * a record has no code, and then in one short form, e.g. "#45eb28d1".
 */

/** Short form of an internal ID: "#" + first 8 characters; "—" when absent. */
export function shortId(id: string | null | undefined): string {
  return id ? `#${id.replace(/-/g, '').slice(0, 8)}` : '—';
}

/** The record's code when it has one, otherwise its short internal ID. */
export function displayCode(code: string | null | undefined, id: string | null | undefined): string {
  const c = typeof code === 'string' ? code.trim() : '';
  return c || shortId(id);
}
