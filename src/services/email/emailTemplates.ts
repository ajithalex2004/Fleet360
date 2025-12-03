/**
 * TRIPEXL Email Templates
 * 
 * Comprehensive email templates for the TRIPEXL maintenance workflow.
 * These templates are ready for integration with email services like SendGrid, AWS SES, or Nodemailer.
 */

import { EnhancedMaintenanceRequest, VendorQuotation, ApprovalLink, Vehicle } from '@/types/maintenance';
import { formatCurrency } from '@/utils/currency';

export interface EmailRecipient {
    email: string;
    name: string;
}

export interface EmailTemplate {
    subject: string;
    htmlBody: string;
    textBody: string;
}

/**
 * 1. RFQ Email Template
 * Sent to garages when requesting quotations
 */
export function generateRFQEmail(
    request: EnhancedMaintenanceRequest,
    vehicle: Vehicle,
    recipient: EmailRecipient
): EmailTemplate {
    const rfqDetails = request.rfqDetails;

    const subject = `RFQ: Maintenance Request #${request.id.toUpperCase()} - ${vehicle.make} ${vehicle.model}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 20px; }
        .section { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
        .label { font-weight: bold; color: #475569; }
        .value { color: #0f172a; }
        .highlight { background: #dbeafe; padding: 10px; border-left: 4px solid #2563eb; margin: 10px 0; }
        .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
        .button { background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Request for Quotation</h2>
            <p>Request #${request.id.toUpperCase()}</p>
        </div>
        
        <div class="content">
            <p>Dear ${recipient.name},</p>
            <p>We are requesting a quotation for the following maintenance work:</p>
            
            <div class="section">
                <h3>Vehicle Information</h3>
                <p><span class="label">Make/Model:</span> <span class="value">${vehicle.make} ${vehicle.model} (${vehicle.year})</span></p>
                <p><span class="label">License Plate:</span> <span class="value">${vehicle.licensePlate}</span></p>
                <p><span class="label">Current Mileage:</span> <span class="value">${vehicle.currentMileage?.toLocaleString() || 'N/A'} km</span></p>
            </div>
            
            <div class="section">
                <h3>Work Required</h3>
                <p><span class="label">Maintenance Type:</span> <span class="value">${request.maintenanceType}</span></p>
                <p><span class="label">Priority:</span> <span class="value">${request.priority}</span></p>
                <p><span class="label">Description:</span></p>
                <p class="value">${request.description}</p>
                ${rfqDetails?.requiredJobTypes ? `
                <p><span class="label">Required Jobs:</span></p>
                <ul>
                    ${rfqDetails.requiredJobTypes.map(job => `<li>${job}</li>`).join('')}
                </ul>
                ` : ''}
            </div>
            
            <div class="highlight">
                <p><span class="label">Work Order Reference:</span> ${rfqDetails?.workOrderReference || `WO-${request.id.toUpperCase()}`}</p>
                <p><span class="label">SLA:</span> ${rfqDetails?.sla || '3-5 days'}</p>
                <p><span class="label">Required Completion:</span> ${rfqDetails?.requiredCompletionDate ? new Date(rfqDetails.requiredCompletionDate).toLocaleDateString() : 'ASAP'}</p>
            </div>
            
            <div class="section">
                <h3>Quotation Requirements</h3>
                <p>Please provide a detailed quotation including:</p>
                <ul>
                    <li>Parts cost breakdown</li>
                    <li>Labor cost and estimated hours</li>
                    <li>Any additional charges</li>
                    <li>Estimated completion time</li>
                    <li>Quotation validity period</li>
                </ul>
            </div>
            
            <p style="text-align: center;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/maintenance/quotations/${request.id}" class="button">
                    Submit Quotation
                </a>
            </p>
            
            <p>Please submit your quotation within 24 hours.</p>
            <p>If you have any questions, please contact our maintenance team.</p>
        </div>
        
        <div class="footer">
            <p>This is an automated message from TRIPEXL Maintenance System</p>
            <p>&copy; ${new Date().getFullYear()} TRIPEXL. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const textBody = `
Request for Quotation
Request #${request.id.toUpperCase()}

Dear ${recipient.name},

We are requesting a quotation for the following maintenance work:

VEHICLE INFORMATION
Make/Model: ${vehicle.make} ${vehicle.model} (${vehicle.year})
License Plate: ${vehicle.licensePlate}
Current Mileage: ${vehicle.currentMileage?.toLocaleString() || 'N/A'} km

WORK REQUIRED
Maintenance Type: ${request.maintenanceType}
Priority: ${request.priority}
Description: ${request.description}

Work Order Reference: ${rfqDetails?.workOrderReference || `WO-${request.id.toUpperCase()}`}
SLA: ${rfqDetails?.sla || '3-5 days'}
Required Completion: ${rfqDetails?.requiredCompletionDate ? new Date(rfqDetails.requiredCompletionDate).toLocaleDateString() : 'ASAP'}

QUOTATION REQUIREMENTS
Please provide a detailed quotation including:
- Parts cost breakdown
- Labor cost and estimated hours
- Any additional charges
- Estimated completion time
- Quotation validity period

Submit your quotation at: ${process.env.NEXT_PUBLIC_APP_URL}/maintenance/quotations/${request.id}

Please submit your quotation within 24 hours.

This is an automated message from TRIPEXL Maintenance System.
    `;

    return { subject, htmlBody, textBody };
}

/**
 * 2. Estimate Approval Email Template
 * Sent to Fleet Manager with approval link
 */
export function generateEstimateApprovalEmail(
    request: EnhancedMaintenanceRequest,
    vehicle: Vehicle,
    quotations: VendorQuotation[],
    approvalLink: ApprovalLink
): EmailTemplate {
    const lowestQuotation = quotations.reduce((min, q) => q.totalCost < min.totalCost ? q : min, quotations[0]);

    const subject = `Estimate Approval Required: Request #${request.id.toUpperCase()} - ${formatCurrency(lowestQuotation.totalCost)}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 20px; }
        .section { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
        .quotation { background: #f0fdf4; border: 2px solid #059669; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .lowest { background: #d1fae5; border-color: #10b981; }
        .label { font-weight: bold; color: #475569; }
        .value { color: #0f172a; }
        .cost { font-size: 24px; font-weight: bold; color: #059669; }
        .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
        .button { background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 5px; }
        .button-reject { background: #dc2626; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Estimate Approval Required</h2>
            <p>Request #${request.id.toUpperCase()}</p>
        </div>
        
        <div class="content">
            <p>Dear Fleet Manager,</p>
            <p>We have received ${quotations.length} quotation(s) for the following maintenance request. Your approval is required to proceed.</p>
            
            <div class="section">
                <h3>Vehicle Information</h3>
                <p><span class="label">Vehicle:</span> <span class="value">${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})</span></p>
                <p><span class="label">Maintenance Type:</span> <span class="value">${request.maintenanceType}</span></p>
                <p><span class="label">Priority:</span> <span class="value">${request.priority}</span></p>
            </div>
            
            <div class="section">
                <h3>Quotation Comparison</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Garage</th>
                            <th>Parts</th>
                            <th>Labor</th>
                            <th>Total</th>
                            <th>Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${quotations.map(q => `
                        <tr style="${q.id === lowestQuotation.id ? 'background: #d1fae5; font-weight: bold;' : ''}">
                            <td>${q.garageName}${q.id === lowestQuotation.id ? ' ⭐' : ''}</td>
                            <td>${formatCurrency(q.partsCost)}</td>
                            <td>${formatCurrency(q.laborCost)}</td>
                            <td>${formatCurrency(q.totalCost)}</td>
                            <td>${q.estimatedDuration} days</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p style="font-size: 12px; color: #64748b; margin-top: 10px;">⭐ = Lowest cost quotation</p>
            </div>
            
            <div class="quotation lowest">
                <h3>Recommended: ${lowestQuotation.garageName}</h3>
                <p class="cost">${formatCurrency(lowestQuotation.totalCost)}</p>
                <p><span class="label">Parts:</span> ${formatCurrency(lowestQuotation.partsCost)} | 
                   <span class="label">Labor:</span> ${formatCurrency(lowestQuotation.laborCost)} | 
                   <span class="label">Other:</span> ${formatCurrency(lowestQuotation.otherCharges)}</p>
                <p><span class="label">Estimated Duration:</span> ${lowestQuotation.estimatedDuration} days</p>
                ${lowestQuotation.notes ? `<p><span class="label">Notes:</span> ${lowestQuotation.notes}</p>` : ''}
            </div>
            
            <p style="text-align: center;">
                <a href="${approvalLink.approvalUrl}" class="button">
                    Review & Approve
                </a>
            </p>
            
            <p style="text-align: center; font-size: 12px; color: #64748b;">
                This approval link expires in ${approvalLink.expiresInHours} hours
            </p>
            
            <p>Please review the quotations and approve or reject to proceed with the maintenance work.</p>
        </div>
        
        <div class="footer">
            <p>This is an automated message from TRIPEXL Maintenance System</p>
            <p>&copy; ${new Date().getFullYear()} TRIPEXL. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const textBody = `
Estimate Approval Required
Request #${request.id.toUpperCase()}

Dear Fleet Manager,

We have received ${quotations.length} quotation(s) for the following maintenance request. Your approval is required to proceed.

VEHICLE INFORMATION
Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})
Maintenance Type: ${request.maintenanceType}
Priority: ${request.priority}

QUOTATION COMPARISON
${quotations.map(q => `
${q.garageName}${q.id === lowestQuotation.id ? ' (LOWEST)' : ''}
Parts: ${formatCurrency(q.partsCost)} | Labor: ${formatCurrency(q.laborCost)} | Total: ${formatCurrency(q.totalCost)}
Duration: ${q.estimatedDuration} days
`).join('\n')}

RECOMMENDED: ${lowestQuotation.garageName}
Total Cost: ${formatCurrency(lowestQuotation.totalCost)}
Parts: ${formatCurrency(lowestQuotation.partsCost)}
Labor: ${formatCurrency(lowestQuotation.laborCost)}
Other: ${formatCurrency(lowestQuotation.otherCharges)}
Duration: ${lowestQuotation.estimatedDuration} days

Review and approve at: ${approvalLink.approvalUrl}

This approval link expires in ${approvalLink.expiresInHours} hours.

This is an automated message from TRIPEXL Maintenance System.
    `;

    return { subject, htmlBody, textBody };
}

/**
 * 3. Maintenance Completed Notification
 * Sent to driver/fleet manager when work is completed
 */
export function generateMaintenanceCompletedEmail(
    request: EnhancedMaintenanceRequest,
    vehicle: Vehicle,
    actualCost: number,
    estimatedCost: number
): EmailTemplate {
    const variance = actualCost - estimatedCost;
    const variancePercent = ((variance / estimatedCost) * 100).toFixed(1);

    const subject = `Maintenance Completed: ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 20px; }
        .section { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
        .success { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 15px 0; }
        .label { font-weight: bold; color: #475569; }
        .value { color: #0f172a; }
        .cost-comparison { display: flex; justify-content: space-around; margin: 20px 0; }
        .cost-item { text-align: center; }
        .cost-value { font-size: 24px; font-weight: bold; }
        .variance-positive { color: #dc2626; }
        .variance-negative { color: #10b981; }
        .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
        .button { background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>✓ Maintenance Completed</h2>
            <p>Request #${request.id.toUpperCase()}</p>
        </div>
        
        <div class="content">
            <div class="success">
                <h3>Work Completed Successfully</h3>
                <p>The maintenance work for your vehicle has been completed and is ready for pickup/use.</p>
            </div>
            
            <div class="section">
                <h3>Vehicle Information</h3>
                <p><span class="label">Vehicle:</span> <span class="value">${vehicle.make} ${vehicle.model}</span></p>
                <p><span class="label">License Plate:</span> <span class="value">${vehicle.licensePlate}</span></p>
                <p><span class="label">Maintenance Type:</span> <span class="value">${request.maintenanceType}</span></p>
            </div>
            
            <div class="section">
                <h3>Cost Summary</h3>
                <div class="cost-comparison">
                    <div class="cost-item">
                        <p class="label">Estimated</p>
                        <p class="cost-value">${formatCurrency(estimatedCost)}</p>
                    </div>
                    <div class="cost-item">
                        <p class="label">Actual</p>
                        <p class="cost-value">${formatCurrency(actualCost)}</p>
                    </div>
                    <div class="cost-item">
                        <p class="label">Variance</p>
                        <p class="cost-value ${variance > 0 ? 'variance-positive' : 'variance-negative'}">
                            ${variance > 0 ? '+' : ''}${formatCurrency(variance)}
                        </p>
                        <p style="font-size: 12px;">(${variance > 0 ? '+' : ''}${variancePercent}%)</p>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <h3>Work Performed</h3>
                <p>${request.description}</p>
                ${request.workOrderClosure?.completionNotes ? `
                <p><span class="label">Completion Notes:</span></p>
                <p>${request.workOrderClosure.completionNotes}</p>
                ` : ''}
            </div>
            
            <div class="section">
                <h3>Quality Check</h3>
                <p>✓ Quality inspection passed</p>
                <p>✓ Vehicle ready for use</p>
            </div>
            
            <p style="text-align: center;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/maintenance/requests/${request.id}" class="button">
                    View Full Details
                </a>
            </p>
        </div>
        
        <div class="footer">
            <p>This is an automated message from TRIPEXL Maintenance System</p>
            <p>&copy; ${new Date().getFullYear()} TRIPEXL. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const textBody = `
Maintenance Completed
Request #${request.id.toUpperCase()}

WORK COMPLETED SUCCESSFULLY
The maintenance work for your vehicle has been completed and is ready for pickup/use.

VEHICLE INFORMATION
Vehicle: ${vehicle.make} ${vehicle.model}
License Plate: ${vehicle.licensePlate}
Maintenance Type: ${request.maintenanceType}

COST SUMMARY
Estimated: ${formatCurrency(estimatedCost)}
Actual: ${formatCurrency(actualCost)}
Variance: ${variance > 0 ? '+' : ''}${formatCurrency(variance)} (${variance > 0 ? '+' : ''}${variancePercent}%)

WORK PERFORMED
${request.description}

QUALITY CHECK
✓ Quality inspection passed
✓ Vehicle ready for use

View full details at: ${process.env.NEXT_PUBLIC_APP_URL}/maintenance/requests/${request.id}

This is an automated message from TRIPEXL Maintenance System.
    `;

    return { subject, htmlBody, textBody };
}

/**
 * 4. Rejection Notification Email
 * Sent when estimate is rejected
 */
export function generateEstimateRejectionEmail(
    request: EnhancedMaintenanceRequest,
    vehicle: Vehicle,
    rejectionReason: string
): EmailTemplate {
    const subject = `Estimate Rejected: Request #${request.id.toUpperCase()} - Action Required`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 20px; }
        .section { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
        .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 15px 0; }
        .label { font-weight: bold; color: #475569; }
        .value { color: #0f172a; }
        .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
        .button { background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Estimate Rejected</h2>
            <p>Request #${request.id.toUpperCase()}</p>
        </div>
        
        <div class="content">
            <p>Dear Maintenance Team,</p>
            
            <div class="warning">
                <h3>Action Required</h3>
                <p>The Fleet Manager has rejected all quotations for this maintenance request. New quotations are required.</p>
            </div>
            
            <div class="section">
                <h3>Vehicle Information</h3>
                <p><span class="label">Vehicle:</span> <span class="value">${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})</span></p>
                <p><span class="label">Maintenance Type:</span> <span class="value">${request.maintenanceType}</span></p>
            </div>
            
            <div class="section">
                <h3>Rejection Reason</h3>
                <p>${rejectionReason}</p>
            </div>
            
            <div class="section">
                <h3>Next Steps</h3>
                <ol>
                    <li>Review the rejection reason</li>
                    <li>Request new quotations from garages</li>
                    <li>Submit updated quotations for approval</li>
                </ol>
            </div>
            
            <p style="text-align: center;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/maintenance/estimation/${request.id}" class="button">
                    Request New Quotations
                </a>
            </p>
        </div>
        
        <div class="footer">
            <p>This is an automated message from TRIPEXL Maintenance System</p>
            <p>&copy; ${new Date().getFullYear()} TRIPEXL. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const textBody = `
Estimate Rejected
Request #${request.id.toUpperCase()}

ACTION REQUIRED
The Fleet Manager has rejected all quotations for this maintenance request. New quotations are required.

VEHICLE INFORMATION
Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})
Maintenance Type: ${request.maintenanceType}

REJECTION REASON
${rejectionReason}

NEXT STEPS
1. Review the rejection reason
2. Request new quotations from garages
3. Submit updated quotations for approval

Request new quotations at: ${process.env.NEXT_PUBLIC_APP_URL}/maintenance/estimation/${request.id}

This is an automated message from TRIPEXL Maintenance System.
    `;

    return { subject, htmlBody, textBody };
}

/**
 * Email Service Integration Helper
 * Ready for SendGrid, AWS SES, or Nodemailer
 */
export async function sendEmail(
    to: EmailRecipient | EmailRecipient[],
    template: EmailTemplate,
    from: EmailRecipient = { email: 'noreply@tripexl.com', name: 'TRIPEXL Maintenance' }
): Promise<boolean> {
    // TODO: Integrate with actual email service
    // Example for SendGrid:
    /*
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    const msg = {
        to: Array.isArray(to) ? to.map(r => r.email) : to.email,
        from: from.email,
        subject: template.subject,
        text: template.textBody,
        html: template.htmlBody,
    };
    
    await sgMail.send(msg);
    */

    console.log('Email would be sent:', {
        to,
        from,
        subject: template.subject
    });

    return true;
}
