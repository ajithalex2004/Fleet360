/**
 * tests/unit/display-id.test.ts
 *
 * Records are shown by their code; the internal ID only when there is no
 * code, and then always as "#" + 8 characters.
 */
import { describe, it, expect } from 'vitest';
import { displayCode, shortId } from '@/lib/ui/display-id';

describe('display-id', () => {
  it('prefers the code over the internal ID', () => {
    expect(displayCode('EXL-360-001', '45eb28d1-5b53-47ef-8d94-c3adbaec06f2')).toBe('EXL-360-001');
    expect(displayCode('  WO-241001 ', 'x')).toBe('WO-241001');
  });

  it('falls back to a short ID only when there is no code', () => {
    expect(displayCode(null, '45eb28d1-5b53-47ef-8d94-c3adbaec06f2')).toBe('#45eb28d1');
    expect(displayCode('   ', '45eb28d1-5b53')).toBe('#45eb28d1');
    expect(shortId(undefined)).toBe('—');
  });
});
