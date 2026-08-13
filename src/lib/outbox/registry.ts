/**
 * In-process consumer registry. Each event_type routes to exactly
 * one consumer. (Multi-consumer fan-out is a future extension —
 * today's pattern is one consumer per event_type, and a consumer
 * that wants to do "fan out internally" can register multiple
 * logical handlers behind one consumerName.)
 *
 * Registration is idempotent: calling register() twice with the
 * same event_type overwrites the prior consumer. This matters in
 * Next.js dev mode where modules can reload.
 */
import type { OutboxConsumer } from './types';

const handlers = new Map<string, OutboxConsumer>();

export function register(eventType: string, consumer: OutboxConsumer): void {
  handlers.set(eventType, consumer);
}

export function get(eventType: string): OutboxConsumer | undefined {
  return handlers.get(eventType);
}

export function list(): string[] {
  return Array.from(handlers.keys());
}

/** Test-only. Resets the registry between unit tests. */
export function _resetForTests(): void {
  handlers.clear();
}
