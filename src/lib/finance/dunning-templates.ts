/**
 * Bilingual EN/AR dunning email templates for the 30/60/90 escalation.
 *
 * Each template returns { subject, htmlBody, textBody } ready for sendEmail().
 * Layouts are email-safe (table-based, no flexbox / grid). Arabic blocks
 * are wrapped in a `dir="rtl"` div with `lang="ar"`.
 *
 * The same templates are reusable for any module billing through Finance —
 * the only product-specific variable is `productName` ('Vehicle Lease',
 * 'Rental', 'School Bus contract', etc.).
 */

export type DunningStage = 'reminder_30' | 'notice_60' | 'final_90';

export interface DunningTemplateInput {
  stage: DunningStage;
  /** What's being billed — e.g. 'Vehicle Lease', 'Rental', 'School Bus'. */
  productName?: string;
  lesseeName: string;
  invoiceNo: string;
  outstandingAmount: number;
  currency: string;
  daysOverdue: number;
  dueDate: Date;
  contractRef?: string | null;
  /** URL the customer can visit to view the invoice or pay. Optional. */
  payNowUrl?: string;
  /** Vendor branding. */
  vendor?: { name?: string; phone?: string; email?: string };
}

const VENDOR_DEFAULT = {
  name: 'XL AI Smart Mobility',
  phone: '',
  email: 'finance@xl-mobility.ai',
};

const fmtMoney = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });

interface Bilingual { subject: string; htmlBody: string; textBody: string; }

export function renderDunningEmail(input: DunningTemplateInput): Bilingual {
  const vendor = { ...VENDOR_DEFAULT, ...(input.vendor ?? {}) };
  const product = input.productName ?? 'Vehicle Lease';
  const totalStr = fmtMoney(input.outstandingAmount, input.currency);
  const dueStr = fmtDate(input.dueDate);

  const headlines = HEADLINES[input.stage];
  const bodies = BODIES[input.stage];
  const cta = CTA[input.stage];

  const subject = `${headlines.subject_en}  /  ${headlines.subject_ar}  —  ${input.invoiceNo}`;

  const enBody = bodies
    .en(input, product)
    .replace('{{vendor}}', vendor.name ?? 'XL AI');
  const arBody = bodies
    .ar(input, product)
    .replace('{{vendor}}', vendor.name ?? 'XL AI');

  const htmlBody = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>${headlines.subject_en}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">

        <!-- Header band -->
        <tr><td style="background:${headlines.color};padding:18px 24px;color:#ffffff">
          <div style="font-size:18px;font-weight:bold">${vendor.name}</div>
          <div style="font-size:14px;opacity:0.9;margin-top:2px">${headlines.subject_en} · ${headlines.subject_ar}</div>
        </td></tr>

        <!-- English block -->
        <tr><td style="padding:24px" dir="ltr" lang="en">
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#1f2937">${headlines.title_en}</h2>
          <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#374151">
            Dear ${escapeHtml(input.lesseeName)},
          </p>
          ${enBody}
          <table cellpadding="6" cellspacing="0" border="0" style="margin:16px 0;font-size:13px;color:#374151">
            <tr><td><strong>${product} invoice:</strong></td><td>${escapeHtml(input.invoiceNo)}</td></tr>
            ${input.contractRef ? `<tr><td><strong>Contract:</strong></td><td>${escapeHtml(input.contractRef)}</td></tr>` : ''}
            <tr><td><strong>Due date:</strong></td><td>${dueStr}</td></tr>
            <tr><td><strong>Days overdue:</strong></td><td><strong style="color:${headlines.color}">${input.daysOverdue} days</strong></td></tr>
            <tr><td><strong>Outstanding:</strong></td><td><strong>${totalStr}</strong></td></tr>
          </table>
          ${input.payNowUrl ? `<p style="margin:16px 0"><a href="${input.payNowUrl}" style="display:inline-block;background:${headlines.color};color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold">${cta.en}</a></p>` : ''}
        </td></tr>

        <!-- Arabic block -->
        <tr><td style="padding:24px;background:#fafafa;border-top:1px solid #e5e7eb" dir="rtl" lang="ar">
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#1f2937;font-family:Arial,sans-serif">${headlines.title_ar}</h2>
          <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#374151">
            عزيزي ${escapeHtml(input.lesseeName)}،
          </p>
          ${arBody}
          <table cellpadding="6" cellspacing="0" border="0" style="margin:16px 0;font-size:13px;color:#374151">
            <tr><td><strong>${headlines.invoice_ar}:</strong></td><td>${escapeHtml(input.invoiceNo)}</td></tr>
            ${input.contractRef ? `<tr><td><strong>${headlines.contract_ar}:</strong></td><td>${escapeHtml(input.contractRef)}</td></tr>` : ''}
            <tr><td><strong>${headlines.due_ar}:</strong></td><td>${dueStr}</td></tr>
            <tr><td><strong>${headlines.daysOverdue_ar}:</strong></td><td><strong style="color:${headlines.color}">${input.daysOverdue} ${headlines.days_ar}</strong></td></tr>
            <tr><td><strong>${headlines.outstanding_ar}:</strong></td><td><strong>${totalStr}</strong></td></tr>
          </table>
          ${input.payNowUrl ? `<p style="margin:16px 0"><a href="${input.payNowUrl}" style="display:inline-block;background:${headlines.color};color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold">${cta.ar}</a></p>` : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 24px;background:#f4f6f8;font-size:12px;color:#6b7280">
          ${vendor.name}${vendor.email ? ` · ${vendor.email}` : ''}${vendor.phone ? ` · ${vendor.phone}` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const textBody = `
${headlines.subject_en} / ${headlines.subject_ar}

Dear ${input.lesseeName},

${stripHtml(enBody)}

${product} invoice: ${input.invoiceNo}
${input.contractRef ? `Contract: ${input.contractRef}\n` : ''}Due date: ${dueStr}
Days overdue: ${input.daysOverdue}
Outstanding: ${totalStr}

— ${vendor.name}
${vendor.email ?? ''}${vendor.phone ? `  ${vendor.phone}` : ''}
`.trim();

  return { subject, htmlBody, textBody };
}

/* ── Stage-specific copy ─────────────────────────────────────────────────── */

const HEADLINES = {
  reminder_30: {
    color: '#d97706', // amber-600
    subject_en: 'Payment Reminder',
    subject_ar: 'تذكير بالدفع',
    title_en: 'Friendly payment reminder',
    title_ar: 'تذكير ودي بالدفع',
    invoice_ar: 'الفاتورة',
    contract_ar: 'العقد',
    due_ar: 'تاريخ الاستحقاق',
    daysOverdue_ar: 'الأيام المتأخرة',
    days_ar: 'يوم',
    outstanding_ar: 'المبلغ المستحق',
  },
  notice_60: {
    color: '#dc2626', // red-600
    subject_en: 'Past-Due Notice',
    subject_ar: 'إشعار تأخر سداد',
    title_en: 'Your invoice is now significantly overdue',
    title_ar: 'فاتورتكم متأخرة بشكل ملحوظ',
    invoice_ar: 'الفاتورة',
    contract_ar: 'العقد',
    due_ar: 'تاريخ الاستحقاق',
    daysOverdue_ar: 'الأيام المتأخرة',
    days_ar: 'يوم',
    outstanding_ar: 'المبلغ المستحق',
  },
  final_90: {
    color: '#7f1d1d', // red-900
    subject_en: 'FINAL NOTICE — Action Required',
    subject_ar: 'إشعار نهائي — مطلوب إجراء',
    title_en: 'Final notice before escalation',
    title_ar: 'إشعار نهائي قبل التصعيد',
    invoice_ar: 'الفاتورة',
    contract_ar: 'العقد',
    due_ar: 'تاريخ الاستحقاق',
    daysOverdue_ar: 'الأيام المتأخرة',
    days_ar: 'يوم',
    outstanding_ar: 'المبلغ المستحق',
  },
} as const;

const BODIES = {
  reminder_30: {
    en: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        This is a friendly reminder that your ${product} invoice <strong>${escapeHtml(i.invoiceNo)}</strong> is now
        <strong>${i.daysOverdue} days past due</strong>. Please arrange settlement at your earliest convenience.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#6b7280">
        If you have already made the payment, please disregard this reminder.
      </p>`,
    ar: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        هذا تذكير ودي بأن فاتورة ${product === 'Vehicle Lease' ? 'إيجار المركبة' : product} رقم
        <strong>${escapeHtml(i.invoiceNo)}</strong> متأخرة الآن
        <strong>${i.daysOverdue} يوماً</strong>. يرجى تسوية المبلغ في أقرب وقت ممكن.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#6b7280">
        إذا كنتم قد سددتم المبلغ، يرجى تجاهل هذا التذكير.
      </p>`,
  },
  notice_60: {
    en: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        We have not received payment for your ${product} invoice <strong>${escapeHtml(i.invoiceNo)}</strong>,
        which is now <strong>${i.daysOverdue} days past due</strong>. Continued non-payment may affect your
        contract status and creditworthiness.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        Please settle the outstanding balance immediately, or contact our finance team to discuss a
        payment arrangement.
      </p>`,
    ar: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        لم نستلم دفعة الفاتورة رقم <strong>${escapeHtml(i.invoiceNo)}</strong>،
        وهي متأخرة الآن <strong>${i.daysOverdue} يوماً</strong>. قد يؤثر استمرار عدم السداد على
        حالة عقدكم وموقفكم الائتماني.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        يرجى تسوية المبلغ المستحق فوراً، أو التواصل مع فريق المالية لدينا لمناقشة ترتيب الدفع.
      </p>`,
  },
  final_90: {
    en: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#7f1d1d">
        <strong>This is a final notice.</strong> Your ${product} invoice <strong>${escapeHtml(i.invoiceNo)}</strong>
        remains unpaid <strong>${i.daysOverdue} days</strong> after its due date.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        Failure to settle the outstanding balance within 7 days will result in suspension of services,
        contract review, and potential escalation to legal recovery proceedings.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        Please contact our finance team immediately to resolve this matter.
      </p>`,
    ar: (i: DunningTemplateInput, product: string) => `
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#7f1d1d">
        <strong>هذا إشعار نهائي.</strong> الفاتورة رقم <strong>${escapeHtml(i.invoiceNo)}</strong>
        لا تزال غير مسددة بعد <strong>${i.daysOverdue} يوماً</strong> من تاريخ الاستحقاق.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        عدم تسوية المبلغ المستحق خلال 7 أيام سيؤدي إلى إيقاف الخدمات، ومراجعة العقد،
        واحتمال التصعيد إلى إجراءات الاسترداد القانونية.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5">
        يرجى التواصل مع فريق المالية فوراً لتسوية هذا الأمر.
      </p>`,
  },
} as const;

const CTA = {
  reminder_30: { en: 'View Invoice', ar: 'عرض الفاتورة' },
  notice_60: { en: 'Pay Now', ar: 'ادفع الآن' },
  final_90: { en: 'Settle Immediately', ar: 'سدد فوراً' },
} as const;

/* ── helpers ─────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
