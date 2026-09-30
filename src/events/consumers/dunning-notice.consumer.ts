/**
 * DunningNoticeConsumer — orchestrates the attempt-token claim protocol
 * defined in src/lib/finance/dunning-dispatch.ts against a single queued
 * LeaseDunningNotice occurrence.
 *
 * Every branch below ends in a definitive local outcome (stale/no-op,
 * suppressed, deferred, or a recorded send outcome) — handle() never
 * throws for a business outcome, only for a genuine infrastructure
 * failure that BaseEventConsumer's retry machinery should see.
 *
 * The one hard rule this file exists to enforce: sendEmail() is called
 * exactly once per handle() invocation, only after the prepared-evidence
 * commit has succeeded, and never while a DB transaction is held open —
 * everything before it and everything after it runs inside its own
 * short transaction.
 */

import { BaseEventConsumer } from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { captureException, captureMessage } from '@/lib/sentry';
import { sendEmail, classifySmtpError } from '@/lib/email';
import { loadEmailTemplate, tenantEmailContext, type LoadedTemplate } from '@/lib/email-templates';
import { escapeHtml } from '@/lib/email-templates/render';
import {
  DUNNING_FALLBACK_KEY, DUNNING_TEMPLATE_KEY, dunningInvoiceBlock, dunningValues,
} from '@/lib/finance/dunning-templates';
import { tenantContact } from '@/lib/tenant-contact';
import {
  claimAttempt,
  preDispatchRecheck,
  resolveDispatchRecipients,
  commitPreparedEvidence,
  recordOutcome,
  getSendAttemptState,
  isTransportAvailable,
  type DunningAttemptOutcome,
} from '@/lib/finance/dunning-dispatch';

export interface DunningNoticeQueuedPayload {
  noticeId: string;
  attemptToken: string;
}

const ACTIVITY_TYPE: Record<string, string> = {
  REMINDER: 'EMAIL',
  OVERDUE: 'EMAIL',
  FINAL_NOTICE: 'LETTER',
  LEGAL_REFERRAL: 'LEGAL',
};

function isDispatchEnabled(): boolean {
  return process.env.DUNNING_DISPATCH_ENABLED === 'true';
}

/** A mock/absent transport must never produce a SUBMITTED outcome — this
 *  is the defensive fallback for a status this file's own gate should
 *  already have prevented from reaching sendEmail() at all. */
function mapSendResultToOutcome(result: {
  status: string;
  errorClass?: string;
}): DunningAttemptOutcome {
  switch (result.status) {
    case 'SENT':
      return 'SUBMITTED';
    case 'FAILED':
      return 'FAILED';
    case 'UNCERTAIN':
      return 'DELIVERY_UNKNOWN';
    default:
      captureMessage('Dunning: sendEmail returned an unexpected status for a gated transport', {
        level: 'error',
        context: 'events.dunning-notice-consumer',
        extra: { status: result.status },
      });
      return 'DELIVERY_UNKNOWN';
  }
}

type ClaimResult =
  | { kind: 'stale' }
  | { kind: 'handled' }
  | {
      kind: 'ready';
      attemptId: string;
      amount: number;
      currency: string;
      to: { email: string; name: string };
      noteForBody?: string;
      emailBody: { subject: string; htmlBody: string; textBody: string };
      replyTo?: string;
      collectionStage: string;
      lesseeId: string;
      contractId: string | null;
      daysOverdue: number;
    };

export class DunningNoticeConsumer extends BaseEventConsumer<DunningNoticeQueuedPayload> {
  readonly consumerName = 'dunning-notice-dispatch';
  readonly eventType = 'finance.dunningNoticeQueued';

  protected async handle(envelope: DomainEventEnvelope<DunningNoticeQueuedPayload>): Promise<void> {
    const tenantId = envelope.tenantId;
    const { noticeId, attemptToken } = envelope.data;

    // ── Gate: dispatch switch + transport availability, checked BEFORE
    // the claim UPDATE runs at all. Gated → DEFERRED, not SUPPRESSED: an
    // operational pause, not a business decision not to contact anyone.
    const transportOk = await isTransportAvailable();
    if (!isDispatchEnabled() || !transportOk) {
      await withTenantRls(prisma, tenantId, async (tx) => {
        const attempt = await tx.leaseDunningDispatchAttempt.findFirst({
          where: { tenantId, attemptToken },
          select: { id: true },
        });
        if (!attempt) return;
        await recordOutcome(tx, tenantId, { attemptId: attempt.id, attemptToken, noticeId }, 'DEFERRED');
      });
      return;
    }

    // The tenant's notice wording (Admin > Email templates > Finance), name,
    // language and reply-to address, loaded before the claim transaction so
    // rendering inside it needs no further database access.
    const context = await tenantEmailContext(tenantId);
    const [templates, contact] = await Promise.all([
      Promise.all([...new Set([...Object.values(DUNNING_TEMPLATE_KEY), DUNNING_FALLBACK_KEY])].map(
        async (key) => [key, await loadEmailTemplate({ tenantId, key, context })] as const,
      )).then((entries) => new Map<string, LoadedTemplate>(entries)),
      tenantContact(tenantId),
    ]);

    const claim = await withTenantRls(prisma, tenantId, async (tx): Promise<ClaimResult> => {
      const claimed = await claimAttempt(tx, tenantId, noticeId, attemptToken);
      if (!claimed) return { kind: 'stale' };

      const attempt = await tx.leaseDunningDispatchAttempt.findFirst({
        where: { tenantId, attemptToken },
        select: { id: true },
      });
      if (!attempt) return { kind: 'stale' };

      const notice = await tx.leaseDunningNotice.findFirst({
        where: { id: noticeId, tenantId },
        select: { collectionStage: true, lesseeId: true, contractId: true },
      });
      if (!notice) return { kind: 'stale' };

      const recheck = await preDispatchRecheck(tx, tenantId, noticeId);
      if (!recheck.ok) {
        await recordOutcome(
          tx, tenantId, { attemptId: attempt.id, attemptToken, noticeId }, 'SUPPRESSED',
          { errorMessage: recheck.reason },
        );
        return { kind: 'handled' };
      }

      const recipients = resolveDispatchRecipients({ email: recheck.recipientEmail, name: recheck.recipientName });
      if (!recipients) {
        // Staging recipient override required but missing — an
        // operational config gap, not a business suppression. Same
        // fail-closed treatment as the transport gate above.
        await recordOutcome(tx, tenantId, { attemptId: attempt.id, attemptToken, noticeId }, 'DEFERRED');
        return { kind: 'handled' };
      }

      const commit = await commitPreparedEvidence(
        tx, tenantId, { attemptId: attempt.id, attemptToken, noticeId },
        { amount: recheck.amount, currency: recheck.currency, recipients: recipients.to },
      );
      if (!commit.ok) {
        await recordOutcome(
          tx, tenantId, { attemptId: attempt.id, attemptToken, noticeId }, 'SUPPRESSED',
          { errorMessage: commit.reason },
        );
        return { kind: 'handled' };
      }

      const daysOverdue = Math.max(0, Math.floor((Date.now() - recheck.dueDate.getTime()) / 86400000));
      const template = templates.get(DUNNING_TEMPLATE_KEY[notice.collectionStage] ?? DUNNING_FALLBACK_KEY)!;
      const invoice = {
        invoiceNo: recheck.invoiceNo ?? recheck.invoiceId.slice(0, 8),
        dueDate: recheck.dueDate,
        daysOverdue,
        outstandingAmount: recheck.amount,
        currency: recheck.currency,
        contractRef: null,
      };
      const email = template.render({
        values: (locale) => dunningValues(invoice, recheck.recipientName, locale),
        blocks: (locale) => ({ invoiceDetails: dunningInvoiceBlock(invoice, locale) }),
      });
      const note = recipients.noteForBody
        ? `<p style="font-size:12px;color:#6b7280;margin:0;padding:12px 32px;">${escapeHtml(recipients.noteForBody)}</p>`
        : '';
      const htmlBody = note ? email.html.replace(/<body[^>]*>/, (tag) => `${tag}${note}`) : email.html;
      const textBody = recipients.noteForBody
        ? `${recipients.noteForBody}\n\n${email.text}`
        : email.text;

      return {
        kind: 'ready',
        attemptId: attempt.id,
        amount: recheck.amount,
        currency: recheck.currency,
        to: recipients.to,
        noteForBody: recipients.noteForBody,
        emailBody: { subject: email.subject, htmlBody, textBody },
        replyTo: contact?.email,
        collectionStage: notice.collectionStage,
        lesseeId: notice.lesseeId,
        contractId: notice.contractId,
        daysOverdue,
      };
    });

    if (claim.kind !== 'ready') return;

    // ── Outside any held transaction: the actual transport call. ────────
    let sendResult: { status: string; errorClass?: string; errorMessage?: string; id?: string };
    try {
      // The platform email sender (Admin > Settings > Notifications SMTP, or
      // SendGrid). Replies go to the tenant's contact address.
      const result = await sendEmail({
        to: claim.to.email,
        subject: claim.emailBody.subject,
        html: claim.emailBody.htmlBody,
        text: claim.emailBody.textBody,
        ...(claim.replyTo ? { replyTo: claim.replyTo } : {}),
      });
      sendResult = result.sent
        ? { status: 'SENT', id: result.id }
        : result.errorClass
          ? {
              status: result.errorClass === 'DEFINITE_FAILURE' ? 'FAILED' : 'UNCERTAIN',
              errorClass: result.errorClass,
              errorMessage: result.error ?? result.reason,
            }
          // No transport (gate raced away) or quarantined: never SUBMITTED.
          : { status: `NOT_SENT:${result.reason ?? 'unknown'}`, errorMessage: result.reason };
    } catch (err) {
      const errorClass = classifySmtpError(err);
      sendResult = {
        // Same classifier, same mapping as a normal sendEmail() return —
        // an UNCERTAIN-classified throw must land on DELIVERY_UNKNOWN, not
        // a retryable FAILED, exactly like the non-throwing path.
        status: errorClass === 'DEFINITE_FAILURE' ? 'FAILED' : 'UNCERTAIN',
        errorClass,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    const outcome = mapSendResultToOutcome(sendResult);

    await withTenantRls(prisma, tenantId, async (tx: TxClient) => {
      let capReached = false;
      if (outcome === 'FAILED') {
        const state = await getSendAttemptState(tx, tenantId, noticeId);
        capReached = state.sendAttemptCount >= state.maxSendAttempts;
      }

      await recordOutcome(
        tx, tenantId, { attemptId: claim.attemptId, attemptToken, noticeId }, outcome,
        {
          errorClass: sendResult.errorClass,
          errorMessage: sendResult.errorMessage,
          providerResponseRef: sendResult.id,
        },
        { capReached },
      );

      if (outcome === 'SUBMITTED') {
        try {
          await tx.leaseDunningActivity.create({
            data: {
              tenantId,
              contractId: claim.contractId,
              lesseeId: claim.lesseeId,
              activityType: ACTIVITY_TYPE[claim.collectionStage] ?? 'EMAIL',
              daysOverdue: claim.daysOverdue,
              outstandingAmount: claim.amount,
              currency: claim.currency,
              performedBy: 'system:dunning',
              response: 'AUTO_SENT',
              notes: `notice=${noticeId} attempt=${attemptToken} stage=${claim.collectionStage}`,
            },
          });
        } catch (err) {
          captureException(err, {
            context: 'events.dunning-notice-consumer.activity-audit',
            tags: { noticeId, tenantId },
          });
        }
      }
    });
  }
}
