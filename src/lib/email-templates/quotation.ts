/** A quotation as shown in the {{quotationDetails}} block. */
export interface QuotationDetails {
  quotationNumber: string;
  lesseeName: string;
  leaseType: string;
  durationMonths?: number;
  startDate?: string;
  endDate?: string;
  validUntil?: string;
  currency?: string;
  totalMonthlyRate?: number;
  totalContractValue?: number;
  securityDeposit?: number;
  mileageCap?: number;
  insuranceIncluded?: boolean;
  maintenanceIncluded?: boolean;
  driverIncluded?: boolean;
  vehicles?: { vehicleType: string; make?: string; model?: string; year?: number; quantity: number; monthlyRate: number }[];
  notes?: string;
}

//  Quotation details block (email template library)
const esc = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DETAIL_LABELS = {
  en: {
    summary: 'Quotation Summary', customer: 'Lessee / Customer', leaseType: 'Lease Type', duration: 'Duration',
    months: 'months', start: 'Start Date', end: 'End Date', mileage: 'Mileage Cap', perMonth: 'km / month',
    unlimited: 'Unlimited', services: 'Bundled Services', none: 'None included', insurance: 'Insurance',
    maintenance: 'Maintenance & Service', driver: 'Driver', vehicles: 'Vehicle Configuration', vehicle: 'Vehicle',
    year: 'Year', qty: 'Qty', rate: 'Rate/Unit', lineTotal: 'Line Total', monthly: 'Total Monthly Rate',
    contract: 'Total Contract Value', deposit: 'Security Deposit', notes: 'Notes',
  },
  ar: {
    summary: 'ملخص العرض', customer: 'المستأجر / العميل', leaseType: 'نوع التأجير', duration: 'المدة',
    months: 'شهر', start: 'تاريخ البدء', end: 'تاريخ الانتهاء', mileage: 'حد المسافة', perMonth: 'كم / شهر',
    unlimited: 'غير محدود', services: 'الخدمات المشمولة', none: 'لا يوجد', insurance: 'التأمين',
    maintenance: 'الصيانة والخدمة', driver: 'السائق', vehicles: 'تفاصيل المركبات', vehicle: 'المركبة',
    year: 'السنة', qty: 'الكمية', rate: 'السعر/الوحدة', lineTotal: 'الإجمالي', monthly: 'إجمالي الإيجار الشهري',
    contract: 'إجمالي قيمة العقد', deposit: 'مبلغ التأمين', notes: 'ملاحظات',
  },
} as const;

/**
 * The quotation summary, vehicles, pricing and notes, for the
 * {{quotationDetails}} block of the "leasing.quotation_sent" template.
 * Every value is escaped; labels follow the email's language.
 */
export function quotationDetailsBlock(q: QuotationDetails, locale: 'en' | 'ar'): { html: string; text: string } {
  const L = DETAIL_LABELS[locale];
  const align = locale === 'ar' ? 'left' : 'right';
  const currency = esc(q.currency ?? 'AED');
  const fmt = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';
  const services = [
    q.insuranceIncluded && L.insurance, q.maintenanceIncluded && L.maintenance, q.driverIncluded && L.driver,
  ].filter(Boolean).join(' • ') || L.none;
  const summary: Array<[string, string]> = [
    [L.customer, q.lesseeName],
    [L.leaseType, q.leaseType.replace(/_/g, ' ')],
    [L.duration, `${q.durationMonths ?? '-'} ${L.months}`],
    [L.start, fmtDate(q.startDate)],
    [L.end, fmtDate(q.endDate)],
    [L.mileage, q.mileageCap ? `${q.mileageCap.toLocaleString()} ${L.perMonth}` : L.unlimited],
    [L.services, services],
  ];
  const td = 'padding:8px 10px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;';
  const th = 'padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;background:#f3f4f6;';
  const vehicles = q.vehicles ?? [];

  const html = [
    `<div style="margin:0 0 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;">`,
    `<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px;">${L.summary}</div>`,
    `<table width="100%" cellspacing="0">${summary.map(([l, v]) => `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:45%;">${l}</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${esc(v)}</td></tr>`).join('')}</table>`,
    `</div>`,
    vehicles.length ? [
      `<div style="font-size:13px;font-weight:700;color:#374151;margin:0 0 8px;">${L.vehicles}</div>`,
      `<table width="100%" cellspacing="0" style="margin:0 0 16px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">`,
      `<tr><th style="${th}">${L.vehicle}</th><th style="${th}">${L.year}</th><th style="${th}">${L.qty}</th><th style="${th}text-align:${align};">${L.rate}</th><th style="${th}text-align:${align};">${L.lineTotal}</th></tr>`,
      ...vehicles.map((v) => `<tr><td style="${td}">${esc(`${v.vehicleType.replace(/_/g, ' ')}${v.make ? ` - ${v.make}` : ''} ${v.model ?? ''}`.trim())}</td><td style="${td}">${esc(String(v.year ?? '-'))}</td><td style="${td}">${v.quantity}</td><td style="${td}text-align:${align};">${currency} ${fmt(v.monthlyRate)}</td><td style="${td}text-align:${align};font-weight:600;color:#059669;">${currency} ${fmt(v.monthlyRate * v.quantity)}</td></tr>`),
      `</table>`,
    ].join('') : '',
    `<div style="margin:0 0 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px 20px;">`,
    `<table width="100%"><tr><td style="color:#065f46;font-size:14px;">${L.monthly}</td><td style="text-align:${align};color:#065f46;font-size:20px;font-weight:700;">${currency} ${fmt(q.totalMonthlyRate ?? 0)}</td></tr>`,
    `<tr><td style="color:#047857;font-size:13px;padding-top:6px;">${L.contract} (${q.durationMonths ?? '-'} ${L.months})</td><td style="text-align:${align};color:#1d4ed8;font-size:16px;font-weight:700;padding-top:6px;">${currency} ${fmt(q.totalContractValue ?? 0)}</td></tr>`,
    q.securityDeposit ? `<tr><td style="color:#6b7280;font-size:12px;padding-top:6px;">${L.deposit}</td><td style="text-align:${align};color:#92400e;font-size:13px;font-weight:600;padding-top:6px;">${currency} ${fmt(q.securityDeposit)}</td></tr>` : '',
    `</table></div>`,
    q.notes ? `<div style="margin:0 0 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;"><div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px;">${L.notes}</div><div style="color:#78350f;font-size:13px;line-height:1.6;">${esc(q.notes).replace(/\n/g, '<br>')}</div></div>` : '',
  ].join('');

  const text = [
    `${L.summary}`,
    ...summary.map(([l, v]) => `${l}: ${v}`),
    ...(vehicles.length ? ['', L.vehicles, ...vehicles.map((v) => `- ${v.vehicleType.replace(/_/g, ' ')} ${v.make ?? ''} ${v.model ?? ''} x${v.quantity}: ${q.currency ?? 'AED'} ${fmt(v.monthlyRate * v.quantity)}`)] : []),
    '',
    `${L.monthly}: ${q.currency ?? 'AED'} ${fmt(q.totalMonthlyRate ?? 0)}`,
    `${L.contract}: ${q.currency ?? 'AED'} ${fmt(q.totalContractValue ?? 0)}`,
    ...(q.securityDeposit ? [`${L.deposit}: ${q.currency ?? 'AED'} ${fmt(q.securityDeposit)}`] : []),
    ...(q.notes ? ['', `${L.notes}: ${q.notes}`] : []),
  ].join('\n');

  return { html, text };
}
