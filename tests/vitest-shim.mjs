/**
 * Vitest API shim for Node.js native test runner.
 * Maps vitest's describe/it/expect/beforeAll/afterAll to node:test equivalents.
 */

import { describe as nodeDescribe, it as nodeIt, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── describe / it ─────────────────────────────────────────────────────────────

export function describe(name, fn) {
  return nodeDescribe(name, fn);
}

export function it(name, fn) {
  return nodeIt(name, { timeout: 30_000 }, fn);
}

export const test = it;

// ── lifecycle hooks ───────────────────────────────────────────────────────────

export function beforeAll(fn) {
  return before(fn, { timeout: 30_000 });
}

export function afterAll(fn) {
  return after(fn, { timeout: 30_000 });
}

export { beforeEach, afterEach };

// ── expect ────────────────────────────────────────────────────────────────────

class Expectation {
  constructor(value) {
    this._value = value;
    this._negated = false;
  }

  get not() {
    const clone = new Expectation(this._value);
    clone._negated = !this._negated;
    return clone;
  }

  _assert(condition, message) {
    if (this._negated) {
      assert.ok(!condition, message ?? `Expected NOT ${JSON.stringify(this._value)}`);
    } else {
      assert.ok(condition, message ?? `Expected ${JSON.stringify(this._value)}`);
    }
  }

  toBe(expected) {
    if (this._negated) {
      assert.notStrictEqual(this._value, expected);
    } else {
      assert.strictEqual(this._value, expected, `Expected ${JSON.stringify(this._value)} to be ${JSON.stringify(expected)}`);
    }
  }

  toEqual(expected) {
    if (this._negated) {
      assert.notDeepStrictEqual(this._value, expected);
    } else {
      assert.deepStrictEqual(this._value, expected);
    }
  }

  toStrictEqual(expected) {
    return this.toEqual(expected);
  }

  toBeTruthy() {
    this._assert(!!this._value, `Expected ${JSON.stringify(this._value)} to be truthy`);
  }

  toBeFalsy() {
    this._assert(!this._value, `Expected ${JSON.stringify(this._value)} to be falsy`);
  }

  toBeNull() {
    this._assert(this._value === null, `Expected ${JSON.stringify(this._value)} to be null`);
  }

  toBeUndefined() {
    this._assert(this._value === undefined, `Expected ${JSON.stringify(this._value)} to be undefined`);
  }

  toBeDefined() {
    this._assert(this._value !== undefined, `Expected value to be defined`);
  }

  toBeGreaterThan(n) {
    this._assert(this._value > n, `Expected ${this._value} > ${n}`);
  }

  toBeGreaterThanOrEqual(n) {
    this._assert(this._value >= n, `Expected ${this._value} >= ${n}`);
  }

  toBeLessThan(n) {
    this._assert(this._value < n, `Expected ${this._value} < ${n}`);
  }

  toBeLessThanOrEqual(n) {
    this._assert(this._value <= n, `Expected ${this._value} <= ${n}`);
  }

  toContain(item) {
    if (typeof this._value === 'string') {
      this._assert(this._value.includes(item), `Expected "${this._value}" to contain "${item}"`);
    } else if (Array.isArray(this._value)) {
      this._assert(this._value.includes(item), `Expected array to contain ${JSON.stringify(item)}`);
    } else {
      throw new Error(`toContain requires string or array, got ${typeof this._value}`);
    }
  }

  toHaveLength(n) {
    this._assert(this._value?.length === n, `Expected length ${this._value?.length} to equal ${n}`);
  }

  toMatch(pattern) {
    if (typeof pattern === 'string') {
      this._assert(this._value.includes(pattern), `Expected "${this._value}" to match "${pattern}"`);
    } else {
      this._assert(pattern.test(this._value), `Expected "${this._value}" to match ${pattern}`);
    }
  }

  toMatchObject(expected) {
    const actual = this._value;
    function matches(a, e) {
      if (e === null || typeof e !== 'object') return a === e;
      if (Array.isArray(e)) {
        if (!Array.isArray(a) || a.length < e.length) return false;
        return e.every((item, i) => matches(a[i], item));
      }
      return Object.keys(e).every(k => matches(a[k], e[k]));
    }
    this._assert(matches(actual, expected), `Expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`);
  }

  toHaveProperty(key, value) {
    const parts = key.split('.');
    let obj = this._value;
    for (const part of parts) {
      obj = obj?.[part];
    }
    if (value !== undefined) {
      this._assert(obj === value, `Expected property ${key} to equal ${JSON.stringify(value)}, got ${JSON.stringify(obj)}`);
    } else {
      this._assert(obj !== undefined, `Expected object to have property ${key}`);
    }
  }

  toBeInstanceOf(cls) {
    this._assert(this._value instanceof cls, `Expected value to be instance of ${cls.name}`);
  }

  toThrow(message) {
    let threw = false;
    let err;
    try {
      if (typeof this._value === 'function') {
        this._value();
      }
    } catch (e) {
      threw = true;
      err = e;
    }
    if (message !== undefined) {
      this._assert(threw && (err?.message ?? '').includes(message), `Expected to throw "${message}"`);
    } else {
      this._assert(threw, 'Expected function to throw');
    }
  }

  resolves = {
    toBeTruthy: async () => this._assert(!!(await this._value)),
    toBe: async (v) => assert.strictEqual(await this._value, v),
  };

  rejects = {
    toThrow: async (msg) => {
      let threw = false;
      try { await this._value; } catch (e) { threw = true; }
      this._assert(threw, 'Expected promise to reject');
    },
  };
}

export function expect(value) {
  return new Expectation(value);
}

// ── vi mock helpers (no-ops for integration tests) ────────────────────────────
export const vi = {
  fn: (impl) => impl ?? (() => {}),
  mock: () => {},
  spyOn: () => ({ mockReturnValue: () => {}, mockImplementation: () => {} }),
  clearAllMocks: () => {},
  resetAllMocks: () => {},
};
