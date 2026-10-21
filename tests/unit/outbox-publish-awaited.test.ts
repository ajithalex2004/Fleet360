/**
 * Outbox publishes are awaited.
 *
 * The event bus writes event_outbox rows in the caller's transaction. A
 * publish started without await — `publishX(...).catch(log)` inside a
 * withTenantRls callback — raced the commit: when the insert landed after
 * it, it failed with "transaction closed", the catch swallowed it, and the
 * state change committed with no event. Awaited, the change and its event
 * commit together or not at all.
 *
 * This scans src for a statement that starts a domain-event publish
 * without awaiting or returning it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Not the outbox: in-process realtime fan-out, and the bus itself.
const IGNORE = [/^src\/lib\/realtime\//, /^src\/events\/event-bus\.ts$/];

const UNAWAITED = /^\s*(void\s+)?(getEventBus\(\)\.publish(Batch)?|publish[A-Z][A-Za-z]*)\s*(<[^>]*>)?\(/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p.split(path.sep).join('/')] : [];
  });
}

describe('outbox publishes', () => {
  it('are never fire-and-forget', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles('src')) {
      if (IGNORE.some((r) => r.test(f))) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (UNAWAITED.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, 'await these (in the caller\'s transaction) instead of .catch-and-forget').toEqual([]);
  });
});
