import { EmailLog, EnhancedMaintenanceRequest } from '@/types/maintenance';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';

/**
 * Functional Email Service
 * Priorities:
 * 1. Database Configuration (Admin > Integrations)
 * 2. Environment Variables (SMTP_HOST, etc.)
 * 3. Mock Fallback (Console Logs)
 */

export interface EmailRecipient {
    email: string;
    name: string;
}

export interface EmailTemplate {
    subject: string;
    htmlBody: string;
    textBody: string;
}

export interface SendEmailParams {
    to: EmailRecipient[];
    cc?: EmailRecipient[];
    subject: string;
    htmlBody: string;
    textBody?: string;
    attachments?: string[];
}

/**
 * Send email (Real implementation with DB + ENV fallback)
 */
export async function sendEmail(params: SendEmailParams): Promise<EmailLog> {
    const recipients = params.to.map(r => r.email).join(', ');
    const ccList = params.cc?.map(r => r.email).join(', ');
    let transport: any;
    let fromAddress = process.env.EMAIL_FROM || '"XL AI Smart Mobility" <noreply@xl-mobility.ai>';

    // Try Database configuration first
    const dbConfig = await prisma.integrationConfig.findFirst({
        where: { type: 'EMAIL', isEnabled: true },
    }).catch(() => null);

    if (dbConfig && dbConfig.host && dbConfig.username) {
        transport = nodemailer.createTransport({
            host: dbConfig.host,
            port: parseInt(dbConfig.port || '587'),
            secure: (dbConfig.encryption || '').toUpperCase() === 'SSL' || dbConfig.port === '465',
            auth: {
                user: dbConfig.username,
                pass: dbConfig.password || '',
            },
            tls: { rejectUnauthorized: false },
        });
        fromAddress = `"${dbConfig.fromName || 'XL AI Smart Mobility'}" <${dbConfig.senderEmail || dbConfig.username}>`;
        console.log(`[EMAIL SERVICE] Using DATABASE configuration for: ${recipients}`);
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        // Fallback to ENV configuration
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_PORT === '465',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS || '',
            },
        });
        console.log(`[EMAIL SERVICE] Using ENVIRONMENT configuration for: ${recipients}`);
    }

    if (transport) {
        try {
            await transport.sendMail({
                from: fromAddress,
                to: recipients,
                cc: ccList,
                subject: params.subject,
                text: params.textBody || params.htmlBody.replace(/<[^>]*>/g, ''),
                html: params.htmlBody,
            });
            console.log(`[EMAIL SERVICE] REAL EMAIL SENT to: ${recipients}`);
        } catch (error) {
            console.error(`[EMAIL SERVICE] FAILED to send real email:`, error);
        }
    } else {
        // Mock fallback
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[EMAIL SERVICE] MOCK EMAIL SENT to: ${recipients}`);
    }

    return {
        id: `email-${Date.now()}`,
        requestId: '',
        emailType: 'NOTIFICATION',
        recipients: params.to.map(r => r.email),
        cc: params.cc?.map(r => r.email),
        subject: params.subject,
        sentAt: new Date().toISOString(),
        status: transport ? 'SENT' : 'MOCK_SENT',
        retryCount: 0
    };
}

/**
 * Send RFQ email to garages
 */
export async function sendRFQEmail(
    request: EnhancedMaintenanceRequest,
    garageEmails: EmailRecipient[]
): Promise<EmailLog> {
    const subject = `Request for Quotation - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Request for Quotation</h2>
        <p>Dear Garage Partner,</p>
        <p>We have a maintenance request that matches your expertise:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
            <li><strong>Description:</strong> ${request.description}</li>
            <li><strong>Priority:</strong> ${request.priority || 'Medium'}</li>
        </ul>
        <p>Please submit your quotation at your earliest convenience.</p>
        <p>Best regards,<br/>Operations Team</p>
    `;

    return sendEmail({
        to: garageEmails,
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });
}

/**
 * Send operations acknowledgment notification
 */
export async function sendOperationsAckNotification(
    request: EnhancedMaintenanceRequest
): Promise<EmailLog> {
    const maintenanceTeam: EmailRecipient[] = [
        { email: 'maintenance@company.com', name: 'Maintenance Team' }
    ];

    const subject = `New Request Pending Approval - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>New Maintenance Request Pending Your Approval</h2>
        <p>Dear Maintenance Team,</p>
        <p>A new maintenance request has been acknowledged by the Operations Team and requires your approval:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
            <li><strong>Priority:</strong> ${request.priority || 'Medium'}</li>
            <li><strong>Description:</strong> ${request.description}</li>
        </ul>
        <p>Please review and approve/reject this request.</p>
        <p>Best regards,<br/>Operations Team</p>
    `;

    const emailLog = await sendEmail({
        to: maintenanceTeam,
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'NOTIFICATION' };
}

/**
 * Send estimation approval request to manager
 */
export async function sendEstimationApprovalEmail(
    request: EnhancedMaintenanceRequest,
    estimateCount: number
): Promise<EmailLog> {
    const managers: EmailRecipient[] = [
        { email: 'manager@company.com', name: 'Fleet Manager' }
    ];

    const subject = `Estimation Approval Required - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Estimation Approval Required</h2>
        <p>Dear Manager,</p>
        <p>We have received ${estimateCount} quotation(s) for the following maintenance request:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
            <li><strong>Description:</strong> ${request.description}</li>
        </ul>
        <p>Please review and approve the estimates.</p>
        <p>Best regards,<br/>Operations Team</p>
    `;

    const emailLog = await sendEmail({
        to: managers,
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'APPROVAL' };
}

/**
 * Send work order confirmation to garage
 */
export async function sendWorkOrderEmail(
    request: EnhancedMaintenanceRequest,
    garageName: string,
    garageEmail: string
): Promise<EmailLog> {
    const subject = `Work Order Confirmation - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Work Order Confirmation</h2>
        <p>Dear ${garageName},</p>
        <p>Your quotation has been approved. Please proceed with the following work order:</p>
        <ul>
            <li><strong>Work Order Number:</strong> WO-${request.id.toUpperCase()}</li>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
            <li><strong>Description:</strong> ${request.description}</li>
        </ul>
        <p>Please confirm receipt and provide an estimated completion date.</p>
        <p>Best regards,<br/>Operations Team</p>
    `;

    const emailLog = await sendEmail({
        to: [{ email: garageEmail, name: garageName }],
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'WORK_ORDER' };
}

/**
 * Send driver assignment notification
 */
export async function sendDriverAssignmentEmail(
    request: EnhancedMaintenanceRequest,
    driverName: string,
    driverEmail: string,
    garageName: string
): Promise<EmailLog> {
    const subject = `Maintenance Assignment - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Maintenance Assignment</h2>
        <p>Dear ${driverName},</p>
        <p>You have been assigned to deliver a vehicle for maintenance:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Garage:</strong> ${garageName}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
        </ul>
        <p>Please coordinate with the garage for drop-off and pickup.</p>
        <p>Best regards,<br/>Operations Team</p>
    `;

    const emailLog = await sendEmail({
        to: [{ email: driverEmail, name: driverName }],
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'NOTIFICATION' };
}

/**
 * Send invoice reminder
 */
export async function sendInvoiceReminderEmail(
    request: EnhancedMaintenanceRequest
): Promise<EmailLog> {
    const operations: EmailRecipient[] = [
        { email: 'operations@company.com', name: 'Operations Team' }
    ];

    const subject = `Invoice Entry Required - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Invoice Entry Required</h2>
        <p>Dear Operations Team,</p>
        <p>The following maintenance work has been completed and requires invoice entry:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
        </ul>
        <p>Please enter the invoice details to close this job.</p>
        <p>Best regards,<br/>System</p>
    `;

    const emailLog = await sendEmail({
        to: operations,
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'REMINDER' };
}

/**
 * Send job closure notification
 */
export async function sendJobClosureEmail(
    request: EnhancedMaintenanceRequest
): Promise<EmailLog> {
    const stakeholders: EmailRecipient[] = [
        { email: 'operations@company.com', name: 'Operations Team' },
        { email: 'maintenance@company.com', name: 'Maintenance Team' },
        { email: 'manager@company.com', name: 'Fleet Manager' }
    ];

    const subject = `Job Closed - ${request.id.toUpperCase()}`;

    const htmlBody = `
        <h2>Job Completion Summary</h2>
        <p>Dear Team,</p>
        <p>The following maintenance job has been successfully completed and closed:</p>
        <ul>
            <li><strong>Request ID:</strong> ${request.id.toUpperCase()}</li>
            <li><strong>Maintenance Type:</strong> ${request.maintenanceType || 'N/A'}</li>
            <li><strong>Final Cost:</strong> AED ${request.actualCost?.toLocaleString() || 'N/A'}</li>
        </ul>
        <p>Thank you for your coordination.</p>
        <p>Best regards,<br/>System</p>
    `;

    const emailLog = await sendEmail({
        to: stakeholders,
        subject,
        htmlBody,
        textBody: htmlBody.replace(/<[^>]*>/g, '')
    });

    return { ...emailLog, requestId: request.id, emailType: 'CLOSURE' };
}

/**
 * Retry failed email
 */
export async function retryEmail(emailLog: EmailLog): Promise<EmailLog> {
    console.log(`[EMAIL SERVICE] Retrying email: ${emailLog.id}`);

    // Simulate retry
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
        ...emailLog,
        sentAt: new Date().toISOString(),
        status: 'SENT',
        retryCount: emailLog.retryCount + 1,
        errorMessage: undefined
    };
}
