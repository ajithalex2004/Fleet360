/**
 * Overdue-payment (dunning) notices: which email template each collection
 * stage uses, and the invoice table shown in it.
 *
 * The wording lives in the tenant email templates (src/lib/email-templates,
 * Admin > Email templates > Finance): each stage has English and Arabic
 * wording, and a notice carries both languages in one email, the tenant's
 * language first. The consumer (src/events/consumers/dunning-notice.consumer.ts)
 * loads the template before its claim transaction and renders inside it, so
 * the exact email is recorded as evidence before it is sent.
 */
import type { EmailBlock } from '@/lib/email-templates/render';
import { escapeHtml } from '@/lib/email-templates/render';
import type { EmailLocale } from '@/lib/email-templates/catalogue';

/** Template for each LeaseDunningNotice.collectionStage. */
export const DUNNING_TEMPLATE_KEY: Record<string, string> = {
  REMINDER: 'finance.dunning_reminder',
  OVERDUE: 'finance.dunning_past_due',
  FINAL_NOTICE: 'finance.dunning_final_notice',
  LEGAL_REFERRAL: 'finance.dunning_legal_referral',
};

/** The most severe notice, for an unknown stage. */
export const DUNNING_FALLBACK_KEY = 'finance.dunning_final_notice';

export interface DunningInvoice {
  invoiceNo: string;
  dueDate: Date;
  daysOverdue: number;
  outstandingAmount: number;
  currency: string;
  contractRef?: string | null;
}

const LABELS = {
  en: { product: 'Vehicle Lease', invoice: 'Invoice', contract: 'Contract', due: 'Due date', overdue: 'Days overdue', days: 'days', outstanding: 'Outstanding' },
  ar: { product: 'إيجار المركبة', invoice: 'الفاتورة', contract: 'العقد', due: 'تاريخ الاستحقاق', overdue: 'الأيام المتأخرة', days: 'يوم', outstanding: 'المبلغ المستحق' },
} as const;

export const formatMoney = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatDueDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });

/** Variable values for one language of a notice. */
export function dunningValues(invoice: DunningInvoice, customerName: string, locale: EmailLocale): Record<string, string> {
  return {
    customerName,
    invoiceNo: invoice.invoiceNo,
    productName: LABELS[locale].product,
    dueDate: formatDueDate(invoice.dueDate),
    daysOverdue: String(invoice.daysOverdue),
    outstandingAmount: formatMoney(invoice.outstandingAmount, invoice.currency),
  };
}

/** The {{invoiceDetails}} table for one language; every value escaped. */
export function dunningInvoiceBlock(invoice: DunningInvoice, locale: EmailLocale): EmailBlock {
  const L = LABELS[locale];
  const rows: Array<[string, string, boolean]> = [
    [L.invoice, invoice.invoiceNo, false],
    ...(invoice.contractRef ? [[L.contract, invoice.contractRef, false] as [string, string, boolean]] : []),
    [L.due, formatDueDate(invoice.dueDate), false],
    [L.overdue, `${invoice.daysOverdue} ${L.days}`, true],
    [L.outstanding, formatMoney(invoice.outstandingAmount, invoice.currency), true],
  ];
  return {
    html: `<table cellpadding="6" cellspacing="0" style="margin:0 0 16px;font-size:14px;color:#374151;border:1px solid #e5e7eb;border-radius:8px;">${rows.map(([label, value, strong]) =>
      `<tr><td style="color:#6b7280;">${label}</td><td>${strong ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value)}</td></tr>`).join('')}</table>`,
    text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
  };
}
