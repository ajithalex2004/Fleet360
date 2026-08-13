/**
 * Circuit breaker for the dual-write local-DB mirror.
 *
 * Why a separate module: the breaker is pure state (counters + a clock
 * check). Extracting it lets us unit-test the failure thresholds and
 * half-open behavior without spinning up Prisma, and lets the dual-write
 * middleware in `prisma.ts` read like orchestration rather than state
 * management.
 *
 * Design intent (see ARCHITECTURE.md §5):
 * - Open after N consecutive failures, pause for COOLDOWN_MS.
 * - Half-open after cooldown: allow ONE probe. Success closes, failure
 *   re-opens.
 * - Per-database, NOT per-table. A hot-table failure takes the whole
 *   mirror offline for a minute. This is deliberate — the mirror is a
 *   write BUFFER, not a transactional guarantee; absorbing a one-minute
 *   pause during a hot-table outage is acceptable.
 */

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the breaker. */
  threshold: number;
  /** Milliseconds to keep the breaker open before allowing a probe. */
  cooldownMs: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Optional onOpen hook for observability (logs / metrics). */
  onOpen?: () => void;
}

export class MirrorCircuitBreaker {
  private failCount = 0;
  private open = false;
  private cooldownEnd = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onOpen?: () => void;

  constructor(config: CircuitBreakerConfig) {
    this.threshold = config.threshold;
    this.cooldownMs = config.cooldownMs;
    this.now = config.now ?? Date.now;
    this.onOpen = config.onOpen;
  }

  /**
   * Returns true if the breaker is currently open (caller should skip the write).
   *
   * When the cooldown has elapsed but we haven't yet observed a probe, the
   * breaker is "half-open": isOpen() returns false so the caller is allowed
   * through, but `this.open` remains true so that a probe failure can be
   * distinguished from a normal closed-state failure (re-opens immediately
   * rather than waiting for `threshold` more failures).
   */
  isOpen(): boolean {
    if (!this.open) return false;
    if (this.now() < this.cooldownEnd) return true;     // still in cooldown
    // Cooldown elapsed → half-open. Allow one probe through. Don't mutate
    // state here; recordFailure / recordSuccess handle the transition.
    return false;
  }

  /** Record a successful mirror write. Closes the breaker and resets the counter. */
  recordSuccess(): void {
    this.failCount = 0;
    this.open = false;
  }

  /**
   * Record a failed mirror write. Three cases:
   *
   *   1. CLOSED state, under threshold  → count up, stay closed.
   *   2. CLOSED state, crosses threshold → open with fresh cooldown.
   *   3. OPEN half-open (cooldown elapsed) → re-open immediately with
   *      a fresh cooldown; the underlying service just failed its probe.
   *
   * Returns true iff this call transitioned the breaker to OPEN.
   */
  recordFailure(): boolean {
    if (this.open && this.now() >= this.cooldownEnd) {
      // Half-open probe failed — re-open with fresh cooldown. Don't increment
      // failCount; the probe is binary (success/failure), not cumulative.
      this.cooldownEnd = this.now() + this.cooldownMs;
      this.failCount = 0;
      this.onOpen?.();
      return true;
    }
    this.failCount++;
    if (!this.open && this.failCount >= this.threshold) {
      this.open = true;
      this.cooldownEnd = this.now() + this.cooldownMs;
      this.onOpen?.();
      return true;
    }
    return false;
  }

  /** Test/diagnostic accessor. */
  get state(): { failCount: number; open: boolean; cooldownEnd: number } {
    return { failCount: this.failCount, open: this.open, cooldownEnd: this.cooldownEnd };
  }

  /** Reset state. Used by tests; do not call in production code. */
  reset(): void {
    this.failCount = 0;
    this.open = false;
    this.cooldownEnd = 0;
  }
}