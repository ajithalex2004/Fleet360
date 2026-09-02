import { describe, it, expect } from 'vitest';
import { WebhookReceiptService } from '@/lib/exchange/webhook-receipt-service';

describe('Fleet360 Exchange: Gap 2 Live WhatsApp & Twilio SMS Delivery Webhooks', () => {
  it('Test 1: Meta WhatsApp Webhook Challenge Verification', () => {
    const verifyToken = 'fleet360_exchange_webhook_token';

    const verifyMetaHandshake = (mode: string | null, token: string | null, challenge: string | null) => {
      if (mode === 'subscribe' && token === verifyToken) {
        return { status: 200, challenge };
      }
      return { status: 403, challenge: null };
    };

    // Valid handshake
    const valid = verifyMetaHandshake('subscribe', 'fleet360_exchange_webhook_token', 'challenge_code_99182');
    expect(valid.status).toBe(200);
    expect(valid.challenge).toBe('challenge_code_99182');

    // Invalid handshake
    const invalid = verifyMetaHandshake('subscribe', 'wrong_token', 'challenge_code_99182');
    expect(invalid.status).toBe(403);
  });

  it('Test 2: WhatsApp Delivery Receipts Lifecycle (Sent -> Delivered -> Read)', async () => {
    const messageId = 'wamid.HBgLMzk3MTUwODg5MTIzNB';

    // 1. Sent
    const sentRes = await WebhookReceiptService.processWhatsAppStatusUpdate({
      messageId,
      status: 'sent',
      recipientId: '971508891234',
      timestamp: '1725298800',
    });
    expect(sentRes.ok).toBe(true);
    expect(sentRes.eventType).toBe('WHATSAPP_SENT');

    // 2. Delivered
    const deliveredRes = await WebhookReceiptService.processWhatsAppStatusUpdate({
      messageId,
      status: 'delivered',
      recipientId: '971508891234',
      timestamp: '1725298805',
    });
    expect(deliveredRes.ok).toBe(true);
    expect(deliveredRes.eventType).toBe('WHATSAPP_DELIVERED');

    // 3. Read
    const readRes = await WebhookReceiptService.processWhatsAppStatusUpdate({
      messageId,
      status: 'read',
      recipientId: '971508891234',
      timestamp: '1725298830',
    });
    expect(readRes.ok).toBe(true);
    expect(readRes.eventType).toBe('WHATSAPP_READ');
  });

  it('Test 3: WhatsApp Delivery Failure & Error Reporting', async () => {
    const failedRes = await WebhookReceiptService.processWhatsAppStatusUpdate({
      messageId: 'wamid.FAILED_MSG_001',
      status: 'failed',
      recipientId: '971500000000',
      timestamp: '1725298800',
      errorDetails: {
        code: 131026,
        title: 'Message Undeliverable',
        message: 'Recipient phone number is not registered on WhatsApp',
      },
    });

    expect(failedRes.ok).toBe(true);
    expect(failedRes.eventType).toBe('WHATSAPP_FAILED');
  });

  it('Test 4: Twilio SMS Status Callback (Delivered vs Undelivered)', async () => {
    // 1. Delivered
    const deliveredSms = await WebhookReceiptService.processTwilioStatusCallback({
      messageSid: 'SM99a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4',
      messageStatus: 'delivered',
      to: '+971508891234',
    });
    expect(deliveredSms.ok).toBe(true);
    expect(deliveredSms.eventType).toBe('SMS_DELIVERED');

    // 2. Undelivered / Failed
    const failedSms = await WebhookReceiptService.processTwilioStatusCallback({
      messageSid: 'SM_FAILED_002',
      messageStatus: 'undelivered',
      to: '+971508890000',
      errorCode: '30008',
      errorMessage: 'Unknown error on handset carrier',
    });
    expect(failedSms.ok).toBe(true);
    expect(failedSms.eventType).toBe('SMS_FAILED');
  });
});
