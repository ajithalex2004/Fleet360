import { prisma } from '@/lib/prisma';
import nodemailer from 'nodemailer';
import { NotificationEvent, RecipientType } from '@prisma/client';

// Global transporter cache to prevent re-instantiation
let cachedTransporter: nodemailer.Transporter | null = null;
let lastConfigHash: string = '';

export const sendServerEmail = async (
    recipient: string,
    subject: string,
    body: string,
    triggerReason: string
) => {
    try {
        console.log(`[ServerNotification] Sending Email to ${recipient}`, { subject });

        // 1. Fetch Integration Config
        const config = await prisma.integrationConfig.findUnique({
            where: { type: 'EMAIL' },
        });

        if (!config || !config.isEnabled) {
            console.warn('[ServerNotification] SMTP config missing/disabled. Logging as Mock Sent.');
            // ... (log mock)
            return true;
        }

        // 2. Configure Transporter (Reuse if possible)
        const configHash = `${config.host}:${config.port}:${config.username}`;

        if (!cachedTransporter || lastConfigHash !== configHash) {
            console.log('[ServerNotification] Initializing new SMTP Transporter');
            cachedTransporter = nodemailer.createTransport({
                host: config.host!,
                port: parseInt(config.port || '587'),
                secure: config.encryption === 'SSL',
                auth: {
                    user: config.username!,
                    pass: config.password!,
                },
                tls: {
                    rejectUnauthorized: false
                }
            });
            lastConfigHash = configHash;
        }

        // 3. Send Email using cached transporter
        await cachedTransporter.sendMail({
            from: `"${config.fromName}" <${config.senderEmail}>`,
            to: recipient,
            subject,
            html: body,
        });

        // 4. Log Success
        await prisma.notificationLog.create({
            data: {
                recipient,
                type: 'Email',
                subject,
                body,
                triggerReason,
                status: 'Sent',
            }
        });

        return true;

    } catch (error: any) {
        console.error('[ServerNotification] Failed to send email:', error);

        // Log Failure
        try {
            await prisma.notificationLog.create({
                data: {
                    recipient,
                    type: 'Email',
                    subject,
                    body,
                    triggerReason,
                    status: 'Failed',
                }
            });
        } catch (logError) {
            console.error('[ServerNotification] Failed to log failure:', logError);
        }

        return false;
    }
};

export const processNotificationRules = async (
    event: string,
    data: Record<string, any>,
    explicitRecipient?: string
) => {
    try {
        console.log(`[ServerNotification] Processing Rules for Event: ${event}`);

        // 1. Fetch enabled rules for this event
        const rules = await prisma.notificationRule.findMany({
            where: {
                event: event as NotificationEvent,
                isEnabled: true,
            },
            include: {
                template: true,
            },
        });

        if (rules.length === 0) {
            console.log(`[ServerNotification] No enabled rules found for ${event}`);
            return;
        }

        let sentCount = 0;

        for (const rule of rules) {
            // @ts-ignore - Handle stale client types
            const template = rule.template;
            if (!template) {
                console.warn(`[ServerNotification] Rule ${rule.id} has no template`);
                continue;
            }

            // 2. Determine Recipients
            const recipients: string[] = [];

            // @ts-ignore - Handle stale client types
            const rTypes = rule.recipientTypes as RecipientType[];

            if (rTypes.includes('ASSIGNEE') && explicitRecipient) {
                recipients.push(explicitRecipient);
            }
            if (rTypes.includes('FLEET_MANAGER')) {
                // Mock logic or fetch actual fleet manager
                recipients.push('fleet.manager@example.com');
            }
            if (rTypes.includes('CUSTOM')) {
                rule.specificRecipientIds.forEach(recipient => {
                    try {
                        const parsed = JSON.parse(recipient);
                        if (parsed.email) recipients.push(parsed.email);
                    } catch {
                        recipients.push(recipient);
                    }
                });
            }

            // 3. Process each channel and recipient
            for (const channel of rule.channels) {
                if (channel === 'EMAIL') {
                    for (const recipient of recipients) {
                        // 4. Render Template
                        let subject = template.subject || 'Notification';
                        let body = template.body;

                        Object.keys(data).forEach(key => {
                            const placeholder = `{{${key}}}`;
                            subject = subject.replace(new RegExp(placeholder, 'g'), String(data[key] || ''));
                            body = body.replace(new RegExp(placeholder, 'g'), String(data[key] || ''));
                        });

                        // 5. Send
                        await sendServerEmail(recipient, subject, body, event);
                        sentCount++;
                    }
                }
                // Add SMS/Whatsapp logic here if needed
            }
        }


        console.log(`[ServerNotification] Processed ${sentCount} notifications for ${event}`);
        return { sent: sentCount, failed: 0 }; // TODO: Track actual failures better

    } catch (error) {
        console.error('[ServerNotification] Error processing rules:', error);
        return { sent: 0, failed: 1, error: String(error) };
    }
};
