
export const sendNotification = async (
    recipientEmail: string,
    subject: string,
    body: string,
    type: 'Email' | 'SMS' | 'WhatsApp' = 'Email',
    triggerReason: string = 'Assignment'
) => {
    try {
        // 1. Send the actual notification
        let status = 'Failed';
        let failureReason: string | undefined;

        console.log(`[NotificationUtils] Sending ${type} to ${recipientEmail}`, { subject, triggerReason });

        if (type === 'Email') {
            const sendResponse = await fetch('/api/notifications/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: recipientEmail, subject, text: body, triggerReason }),
            });
            const sendResult = await sendResponse.json();

            // Log the result for debugging (shows if it was a mock success)
            console.log(`[NotificationUtils] Email API Response for ${recipientEmail}:`, sendResult);

            status = sendResponse.ok ? 'Sent' : 'Failed';
            failureReason = sendResponse.ok ? undefined : (sendResult.error || 'Unknown error');
            // Email API handles duplicates, but if we log here too we get duplicates. 
            // The Email API is configured to log. So we SKIP logging here for Email.
            return status === 'Sent';
        }

        if (type === 'WhatsApp') {
            const sendResponse = await fetch('/api/notifications/whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: recipientEmail, message: body }),
            });
            const sendResult = await sendResponse.json();
            status = sendResponse.ok ? 'Sent' : 'Failed';
            failureReason = sendResponse.ok ? undefined : (sendResult.error || 'Unknown error');
        }

        if (type === 'SMS') {
            // Mock SMS for now
            status = 'Sent';
            console.log(`[NotificationUtils] Mock SMS sent to ${recipientEmail}`);
        }

        console.log(`[NotificationUtils] Send Result for ${recipientEmail}:`, status, failureReason);

        // 2. Log to History (For WhatsApp and SMS only)
        await fetch('/api/notifications/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: recipientEmail,
                type: type,
                status: status,
                subject: subject,
                body: body,
                sentAt: new Date().toISOString(),
                failureReason: failureReason,
                metadata: { trigger: triggerReason }
            }),
        });

        return status === 'Sent';

    } catch (error) {
        console.error('[NotificationUtils] Critical Failure:', error);

        // Try to log the breakdown despite failure
        try {
            await fetch('/api/notifications/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: recipientEmail,
                    type: type,
                    status: 'Failed',
                    subject: subject,
                    body: body,
                    sentAt: new Date().toISOString(),
                    failureReason: error instanceof Error ? error.message : String(error),
                    metadata: { trigger: triggerReason, errorContext: 'Critical Exception' }
                }),
            });
        } catch (logError) {
            console.error('[NotificationUtils] Failed to log failure:', logError);
        }

        return false;
    }
};

interface NotificationRule {
    event: string;
    channels: string[];
    recipientTypes: string[];
    specificRecipientIds: string[];
    templateId?: string;
    template?: {
        subject: string;
        body: string;
    };
    isEnabled: boolean;
}

export const sendEventNotification = async (
    event: string,
    data: Record<string, any>,
    explicitRecipient?: string
) => {
    try {
        console.log(`[NotificationUtils] Processing Event: ${event}`);

        const res = await fetch('/api/admin/notification-rules');
        if (!res.ok) {
            console.warn('[NotificationUtils] Failed to fetch rules');
            return false;
        }
        const rules: NotificationRule[] = await res.json();
        const rule = rules.find(r => r.event === event && r.isEnabled);

        if (!rule) {
            console.log(`[NotificationUtils] No enabled rule found for event: ${event}`);
            return false;
        }

        const template = rule.template;
        if (!template) {
            console.warn('[NotificationUtils] Rule exists but no template found.');
            return false;
        }

        const availableRecipients: string[] = [];
        if (rule.recipientTypes.includes('ASSIGNEE') && explicitRecipient) {
            availableRecipients.push(explicitRecipient);
        }
        if (rule.recipientTypes.includes('FLEET_MANAGER')) {
            availableRecipients.push('fleet.manager@example.com'); // Mock
        }

        if (rule.recipientTypes.includes('CUSTOM')) {
            rule.specificRecipientIds.forEach(recipient => {
                try {
                    // Try parsing as JSON object {name, email}
                    const parsed = JSON.parse(recipient);
                    if (parsed.email) {
                        availableRecipients.push(parsed.email);
                    }
                } catch (e) {
                    // If parsing fails, treat as plain email string (backward compatibility)
                    availableRecipients.push(recipient);
                }
            });
        }

        if (availableRecipients.length === 0 && explicitRecipient) {
            // Fallback: If no types match but explicit given, maybe use it? 
            // Strict config would say no. But for safety:
            // availableRecipients.push(explicitRecipient);
        }

        let sentCount = 0;
        for (const channel of rule.channels) {
            for (const recipient of availableRecipients) {
                let subject = template.subject || 'Notification';
                let body = template.body;

                Object.keys(data).forEach(key => {
                    const placeholder = `{{${key}}}`;
                    subject = subject.replace(new RegExp(placeholder, 'g'), data[key]);
                    body = body.replace(new RegExp(placeholder, 'g'), data[key]);
                });

                const type = channel === 'WHATSAPP' ? 'WhatsApp' :
                    channel === 'SMS' ? 'SMS' : 'Email';

                await sendNotification(recipient, subject, body, type as any, event);
                sentCount++;
            }
        }

        return sentCount > 0;

    } catch (e) {
        console.error('[NotificationUtils] Error in sendEventNotification:', e);
        return false;
    }
};
