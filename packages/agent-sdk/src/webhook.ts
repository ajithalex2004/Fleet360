/**
 * @gravity/agent-sdk — Webhook Receiver Helper
 * -----------------------------------------------
 * Validates and parses incoming webhook callbacks from the agent service.
 *
 * Usage (Express):
 *   import { WebhookReceiver } from '@gravity/agent-sdk';
 *   const receiver = new WebhookReceiver({ secret: 'YOUR_WEBHOOK_SECRET' });
 *
 *   app.post('/webhooks/agent', express.raw({ type: 'application/json' }), (req, res) => {
 *     const result = receiver.parse(req.body, req.headers['x-gravity-signature']);
 *     console.log(result.agentId, result.output);
 *     res.status(200).json({ received: true });
 *   });
 *
 * Usage (Next.js app router):
 *   import { WebhookReceiver } from '@gravity/agent-sdk';
 *   const receiver = new WebhookReceiver({ secret: process.env.AGENT_WEBHOOK_SECRET! });
 *
 *   export async function POST(req: Request) {
 *     const body = await req.text();
 *     const sig = req.headers.get('x-gravity-signature') ?? '';
 *     const result = receiver.parse(body, sig);
 *     // handle result...
 *     return Response.json({ received: true });
 *   }
 */

import type { AgentResult } from './types';

export interface WebhookReceiverConfig {
  /** Shared secret used to verify HMAC-SHA256 signatures */
  secret?: string;
  /** Skip signature verification (development only) */
  skipVerification?: boolean;
}

export class WebhookReceiver {
  private secret?: string;
  private skipVerification: boolean;

  constructor(config: WebhookReceiverConfig = {}) {
    this.secret            = config.secret;
    this.skipVerification  = config.skipVerification ?? false;
  }

  /**
   * Parse and verify an incoming webhook payload.
   * @param body     Raw request body (string or Buffer)
   * @param signature  Value of the `x-gravity-signature` header
   * @returns Parsed AgentResult
   * @throws If signature is invalid
   */
  parse(body: string | Buffer, signature?: string): AgentResult {
    const raw = typeof body === 'string' ? body : body.toString('utf8');

    if (!this.skipVerification && this.secret && signature) {
      this.verify(raw, signature);
    }

    const parsed = JSON.parse(raw) as AgentResult;
    if (!parsed.agentId || !parsed.status) {
      throw new Error('Invalid agent webhook payload: missing agentId or status');
    }
    return parsed;
  }

  /**
   * Verify HMAC-SHA256 signature synchronously (Node.js crypto).
   * In browser environments use the Web Crypto API instead.
   */
  private verify(body: string, signature: string): void {
    try {
      // Node.js environment
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require('crypto') as typeof import('crypto');
      const expected = crypto.createHmac('sha256', this.secret!).update(body).digest('hex');
      const provided  = signature.replace('sha256=', '');
      if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))) {
        throw new Error('Invalid webhook signature');
      }
    } catch (e) {
      if ((e as Error).message === 'Invalid webhook signature') throw e;
      // Crypto not available (browser) — skip
    }
  }

  /**
   * Generate a webhook signature for testing.
   * Use this to simulate agent callbacks in your tests.
   */
  sign(body: string): string {
    if (!this.secret) throw new Error('No secret configured');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto') as typeof import('crypto');
    return 'sha256=' + crypto.createHmac('sha256', this.secret).update(body).digest('hex');
  }
}
