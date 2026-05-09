import { EmailTemplate, EmailRecipient } from './emailService';

/**
 * Fleet360 - Leasing Workflow Email Templates
 */

const BRAND_NAME = 'Fleet360';
const BRAND_COLOR = '#2563eb'; // Deep Tech Blue

/**
 * Base template wrapper to ensure consistent branding
 */
function wrapBaseTemplate(title: string, contentHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .header { background: ${BRAND_COLOR}; color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
    .content { padding: 32px 24px; }
    .footer { background: #f1f5f9; color: #64748b; padding: 24px; text-align: center; font-size: 12px; }
    .button { display: inline-block; padding: 12px 24px; background-color: ${BRAND_COLOR}; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 24px; }
    .data-table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    .data-table td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .label { color: #64748b; font-weight: 500; width: 40%; }
    .value { color: #1e293b; font-weight: 600; }
    .highlight-box { background: #eff6ff; border-left: 4px solid ${BRAND_COLOR}; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; opacity: 0.8;">Fleet360</div>
      <h1>${title}</h1>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.</p>
      <p>Driving the future of sustainable movement.</p>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateInternalApprovalEmail(quoteNumber: string, lesseeName: string, amount: string): EmailTemplate {
  const title = 'Approval Required';
  const htmlBody = wrapBaseTemplate(title, `
    <p>Hello Team,</p>
    <p>A new lease quotation has been generated and requires your internal approval to proceed.</p>
    <div class="highlight-box">
      <strong>Quotation Reference:</strong> ${quoteNumber}
    </div>
    <table class="data-table">
      <tr><td class="label">Lessee</td><td class="value">${lesseeName}</td></tr>
      <tr><td class="label">Total Monthly Rate</td><td class="value">${amount}</td></tr>
    </table>
    <p>Please log in to the portal to review the complete details and approve/reject the request.</p>
    <a href="${process.env.NEXT_PUBLIC_BASE_URL}/leasing/quotations" class="button">View Pipeline</a>
  `);
  return { subject: `[Internal Approval] Lease Quotation ${quoteNumber}`, htmlBody, textBody: `Lease Quotation ${quoteNumber} requires your approval.` };
}

export function generateCustomerQuoteEmail(quoteNumber: string, customerName: string, amount: string): EmailTemplate {
  const title = 'Your Lease Quotation';
  const htmlBody = wrapBaseTemplate(title, `
    <p>Dear ${customerName},</p>
    <p>Thank you for choosing ${BRAND_NAME}. We are pleased to share our official lease quotation for your review.</p>
    <div class="highlight-box">
      <strong>Quotation Reference:</strong> ${quoteNumber}
    </div>
    <table class="data-table">
      <tr><td class="label">Total Monthly Package</td><td class="value">${amount}</td></tr>
    </table>
    <p>Our team is ready to assist you with the next steps. You can review and approve this quotation directly through our secure client window, or by replying to this email.</p>
    <p>We look forward to mobility partnership with you.</p>
  `);
  return { subject: `Lease Quotation from ${BRAND_NAME} - ${quoteNumber}`, htmlBody, textBody: `Your lease quotation ${quoteNumber} is ready for review.` };
}

export function generateCreditReviewEmail(quoteNumber: string, lesseeName: string): EmailTemplate {
  const title = 'Credit Review Request';
  const htmlBody = wrapBaseTemplate(title, `
    <p>Hello Credit Team,</p>
    <p>A customer has approved a lease quotation. Please conduct the final credit assessment to authorize procurement.</p>
    <table class="data-table">
      <tr><td class="label">Quotation ID</td><td class="value">${quoteNumber}</td></tr>
      <tr><td class="label">Customer</td><td class="value">${lesseeName}</td></tr>
    </table>
    <a href="${process.env.NEXT_PUBLIC_BASE_URL}/leasing/quotations" class="button">Review Credit Case</a>
  `);
  return { subject: `[Credit Review] ${lesseeName} - Quote ${quoteNumber}`, htmlBody, textBody: `Credit review requested for ${lesseeName}.` };
}

export function generateHandoverEmail(quoteNumber: string, customerName: string): EmailTemplate {
  const title = 'Delivery Handover Complete';
  const htmlBody = wrapBaseTemplate(title, `
    <p>Congratulations ${customerName}!</p>
    <p>Your vehicle has been successfully delivered and the handover process is complete.</p>
    <p>Welcome to the ${BRAND_NAME} family. Your contract documents have been finalized and are available in your portal.</p>
    <div class="highlight-box">
      <strong>Reference:</strong> ${quoteNumber}
    </div>
    <p>Safe travels!</p>
  `);
  return { subject: `Handover Complete - Welcome to ${BRAND_NAME}`, htmlBody, textBody: `Your vehicle handover is complete. Welcome to ${BRAND_NAME}!` };
}
