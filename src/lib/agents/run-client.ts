/**
 * Browser-side helper for starting an agent run and waiting for it.
 *
 * Starts the run with POST /api/agents/run { async: true } and polls
 * GET /api/agents/run?run_id=… until it leaves RUNNING, so a scan that
 * takes longer than the proxy in front of the app waits no longer shows up
 * as a 502 while the run is in fact completing.
 */

/** Body of POST/GET /api/agents/run: an AgentRunResult plus runId, or { error }. */
export interface AgentRunResponse {
  runId?: string;
  agentId?: string;
  status?: string;
  durationMs?: number;
  itemsProcessed?: number;
  actionsCreated?: number;
  output?: unknown;
  error?: string;
}

export interface AgentRunOutcome {
  /** true when the run finished COMPLETED or PARTIAL — what the synchronous endpoint answers 200 for. */
  ok: boolean;
  /** true when polling gave up while the run was still RUNNING. */
  timedOut: boolean;
  result: AgentRunResponse;
}

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAgentAndWait(
  body: { agent_id: string } & Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<AgentRunOutcome> {
  const res = await fetch('/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, async: true }),
  });
  const started: AgentRunResponse = await res.json().catch(() => ({}));

  // Anything but 202 is already the final answer: a validation or
  // governance failure, or a server that still runs synchronously.
  if (res.status !== 202 || !started?.runId) {
    return { ok: res.ok && started?.status !== 'FAILED', timedOut: false, result: started };
  }

  const runId = started.runId;
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let latest: AgentRunResponse = started;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const poll = await fetch(`/api/agents/run?run_id=${encodeURIComponent(runId)}`, { cache: 'no-store' });
      // A transient gateway error while polling is not the run's outcome;
      // keep polling until the deadline.
      if (!poll.ok) continue;
      latest = await poll.json();
    } catch {
      continue;
    }
    if (latest?.status && latest.status !== 'RUNNING') {
      return { ok: latest.status !== 'FAILED', timedOut: false, result: latest };
    }
  }
  return { ok: false, timedOut: true, result: latest };
}
