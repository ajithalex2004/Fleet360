import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A driver's jobs and vehicles are matched by driver profile id only. Matching
// by name showed a driver every drayage job assigned to anyone whose name
// equalled or merely contained theirs (`LIKE '%name%'`), with the customer,
// container and rates on it.
const ROUTES = [
  'src/app/api/driver-app/today/assignments/route.ts',
  'src/app/api/driver-app/auth/vehicle-login/route.ts',
];

const source = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('driver app matches work to the caller by id, never by name', () => {
  for (const route of ROUTES) {
    it(`${route} has no name-based driver matching`, () => {
      const src = source(route);
      expect(src).not.toMatch(/LOWER\([^)]*assigned_driver_name/i);
      expect(src).not.toMatch(/LOWER\(COALESCE\(d\.name/i);
      expect(src).not.toMatch(/LIKE\s+'%'\s*\|\|/);
    });
  }

  it("today's drayage jobs are filtered by the caller's driver profile ids", () => {
    const src = source(ROUTES[0]);
    expect(src).toMatch(/assigned_driver_id::text = ANY\(\$2::text\[\]\)/);
    expect(src).toMatch(/AND \(id::text = \$2 OR user_id = \$2\)/);
  });
});
