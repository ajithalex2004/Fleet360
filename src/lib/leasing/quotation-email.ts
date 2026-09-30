/**
 * Emailing a lease quotation to the customer, from the submit and approve
 * routes: the tenant's "Lease quotation" template (Admin > Email templates,
 * English or Arabic) with the quotation table as its {{quotationDetails}}
 * block, sent through the platform email sender. Replies go to the user who
 * sent it.
 */
import 'server-only';
import { renderEmail, tenantEmailContext } from '@/lib/email-templates';
import { quotationDetailsBlock } from '@/lib/email-templates/quotation';
import { sendEmail, type EmailSendResult } from '@/lib/email';

export interface QuotationForEmail {
  id: string;
  quotationNumber: string | null;
  leaseType: string | null;
  durationMonths: number | null;
  startDate: Date | null;
  endDate: Date | null;
  validUntil: Date | null;
  currency: string | null;
  totalMonthlyRate: unknown;
  totalContractValue: unknown;
  securityDeposit: unknown;
  mileageCap: number | null;
  insuranceIncluded: boolean | null;
  maintenanceIncluded: boolean | null;
  driverIncluded: boolean | null;
  notes: string | null;
  lessee: { name?: string | null } | null;
  vehicles: Array<Record<string, unknown>>;
}

export async function sendQuotationEmail(args: {
  tenantId: string;
  quotation: QuotationForEmail;
  to: string | string[];
  sender: { email: string; name?: string } | null;
}): Promise<EmailSendResult> {
  const { tenantId, quotation, sender } = args;
  const context = await tenantEmailContext(tenantId);
  const currency = quotation.currency ?? 'AED';
  const money = (n: unknown) => `${currency} ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const details = {
    quotationNumber:    quotation.quotationNumber ?? quotation.id,
    lesseeName:         quotation.lessee?.name ?? '',
    leaseType:          quotation.leaseType ?? 'LONG_TERM',
    durationMonths:     quotation.durationMonths ?? undefined,
    startDate:          quotation.startDate?.toISOString(),
    endDate:            quotation.endDate?.toISOString(),
    validUntil:         quotation.validUntil?.toISOString(),
    currency,
    totalMonthlyRate:   Number(quotation.totalMonthlyRate ?? 0),
    totalContractValue: Number(quotation.totalContractValue ?? 0),
    securityDeposit:    Number(quotation.securityDeposit ?? 0),
    mileageCap:         quotation.mileageCap ?? undefined,
    insuranceIncluded:  quotation.insuranceIncluded ?? false,
    maintenanceIncluded: quotation.maintenanceIncluded ?? false,
    driverIncluded:     quotation.driverIncluded ?? false,
    vehicles:           quotation.vehicles.map((v) => ({
      vehicleType: String(v.vehicleType ?? ''),
      make:        v.make ? String(v.make) : undefined,
      model:       v.model ? String(v.model) : undefined,
      year:        v.year ? Number(v.year) : undefined,
      quantity:    Number(v.quantity ?? 1),
      monthlyRate: Number(v.monthlyRate ?? 0),
    })),
    notes:        quotation.notes ?? undefined,
  };
  const email = await renderEmail({
    tenantId, key: 'leasing.quotation_sent', context,
    values: {
      lesseeName:         details.lesseeName,
      quotationNumber:    details.quotationNumber,
      validUntil:         quotation.validUntil
        ? quotation.validUntil.toLocaleDateString(context.locale === 'ar' ? 'ar-AE' : 'en-AE', { day: '2-digit', month: 'long', year: 'numeric' })
        : '-',
      totalMonthlyRate:   money(quotation.totalMonthlyRate),
      totalContractValue: money(quotation.totalContractValue),
      senderName:         sender?.name ?? '',
      senderEmail:        sender?.email ?? '',
    },
    blocks: { quotationDetails: quotationDetailsBlock(details, context.locale) },
  });
  return sendEmail({
    to: args.to, subject: email.subject, html: email.html, text: email.text,
    ...(sender?.email ? { replyTo: sender.email } : {}),
  });
}
