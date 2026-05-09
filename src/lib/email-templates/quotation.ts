//  Quotation Email HTML Template 
export function quotationEmailHtml(q: {
  quotationNumber: string;
  lesseeName: string;
  lesseeEmail?: string;
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
  companyName?: string;
  contactEmail?: string;
}): string {
  const currency = q.currency ?? 'AED';
  const fmt = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-AE', { day:'2-digit', month:'long', year:'numeric' }) : '-';

  const vehicleRows = (q.vehicles ?? []).map(v => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 12px;color:#111827;">${v.vehicleType.replace(/_/g,' ')} ${v.make ? `- ${v.make}` : ''} ${v.model ?? ''}</td>
      <td style="padding:10px 12px;color:#111827;text-align:center;">${v.year ?? '-'}</td>
      <td style="padding:10px 12px;color:#111827;text-align:center;">${v.quantity}</td>
      <td style="padding:10px 12px;color:#111827;text-align:right;">${currency} ${fmt(v.monthlyRate)}</td>
      <td style="padding:10px 12px;font-weight:600;color:#059669;text-align:right;">${currency} ${fmt(v.monthlyRate * v.quantity)}</td>
    </tr>`).join('');

  const services = [
    q.insuranceIncluded   && 'Insurance',
    q.maintenanceIncluded && 'Maintenance & Service',
    q.driverIncluded      && 'Driver',
  ].filter(Boolean).join(' &bull; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lease Quotation ${q.quotationNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#4338ca 100%);padding:32px 40px;">
    <table width="100%"><tr>
      <td>
        <div style="color:#93c5fd;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Fleet360</div>
        <div style="color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Lease Quotation</div>
        <div style="color:#bfdbfe;font-size:15px;margin-top:6px;">${q.quotationNumber}</div>
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:12px 16px;text-align:right;">
          <div style="color:#bfdbfe;font-size:11px;margin-bottom:2px;">Valid Until</div>
          <div style="color:#ffffff;font-size:14px;font-weight:600;">${fmtDate(q.validUntil)}</div>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 40px 0;">
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      Dear <strong>${q.lesseeName}</strong>,
    </p>
    <p style="margin:12px 0 0;color:#6b7280;font-size:14px;line-height:1.7;">
      Thank you for your interest. Please find below your vehicle lease quotation from <strong>Fleet360</strong>.
      This quotation is valid until <strong>${fmtDate(q.validUntil)}</strong>.
    </p>
  </td></tr>

  <!-- Quotation Details -->
  <tr><td style="padding:24px 40px;">
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:24px;">
      <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;">Quotation Summary</div>
      <table width="100%" cellspacing="0">
        ${[
          ['Lessee / Customer',  q.lesseeName],
          ['Lease Type',         q.leaseType.replace(/_/g,' ')],
          ['Duration',           `${q.durationMonths ?? '-'} months`],
          ['Start Date',         fmtDate(q.startDate)],
          ['End Date',           fmtDate(q.endDate)],
          ['Mileage Cap',        q.mileageCap ? `${q.mileageCap.toLocaleString()} km / month` : 'Unlimited'],
          ['Bundled Services',   services || 'None included'],
        ].map(([l, v]) => `
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;width:45%;">${l}</td>
          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500;">${v}</td>
        </tr>`).join('')}
      </table>
    </div>
  </td></tr>

  <!-- Vehicle Lines -->
  ${vehicleRows ? `
  <tr><td style="padding:0 40px 24px;">
    <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Vehicle Configuration</div>
    <table width="100%" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:12px;font-weight:600;">Vehicle</th>
          <th style="padding:10px 12px;text-align:center;color:#6b7280;font-size:12px;font-weight:600;">Year</th>
          <th style="padding:10px 12px;text-align:center;color:#6b7280;font-size:12px;font-weight:600;">Qty</th>
          <th style="padding:10px 12px;text-align:right;color:#6b7280;font-size:12px;font-weight:600;">Rate/Unit</th>
          <th style="padding:10px 12px;text-align:right;color:#6b7280;font-size:12px;font-weight:600;">Line Total</th>
        </tr>
      </thead>
      <tbody>${vehicleRows}</tbody>
    </table>
  </td></tr>` : ''}

  <!-- Pricing Summary -->
  <tr><td style="padding:0 40px 32px;">
    <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #a7f3d0;border-radius:10px;padding:24px;">
      <table width="100%">
        <tr>
          <td style="color:#065f46;font-size:14px;">Total Monthly Rate</td>
          <td align="right" style="color:#065f46;font-size:22px;font-weight:700;">${currency} ${fmt(q.totalMonthlyRate ?? 0)}</td>
        </tr>
        <tr>
          <td style="color:#047857;font-size:13px;padding-top:8px;">Total Contract Value (${q.durationMonths ?? '-'} months)</td>
          <td align="right" style="color:#1d4ed8;font-size:18px;font-weight:700;padding-top:8px;">${currency} ${fmt(q.totalContractValue ?? 0)}</td>
        </tr>
        ${q.securityDeposit ? `
        <tr>
          <td style="color:#6b7280;font-size:12px;padding-top:8px;border-top:1px solid #a7f3d0;">Security Deposit</td>
          <td align="right" style="color:#92400e;font-size:13px;font-weight:600;padding-top:8px;border-top:1px solid #a7f3d0;">${currency} ${fmt(q.securityDeposit)}</td>
        </tr>` : ''}
      </table>
    </div>
  </td></tr>

  ${q.notes ? `
  <!-- Notes -->
  <tr><td style="padding:0 40px 24px;">
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">NOTES</div>
      <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">${q.notes.replace(/\n/g,'<br>')}</p>
    </div>
  </td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="padding:0 40px 32px;text-align:center;">
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">To accept this quotation or for any queries, please contact us:</p>
    ${q.contactEmail ? `<a href="mailto:${q.contactEmail}" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#4338ca);color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">Reply to This Quotation</a>` : ''}
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1e293b;padding:20px 40px;">
    <table width="100%"><tr>
      <td style="color:#94a3b8;font-size:12px;">
        <strong style="color:#e2e8f0;">Fleet360</strong><br>
        This quotation is computer-generated and valid for the period stated above.
      </td>
      <td align="right" style="color:#64748b;font-size:11px;vertical-align:bottom;">
        ${new Date().toLocaleDateString('en-AE', { day:'2-digit', month:'long', year:'numeric' })}
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function quotationEmailText(q: { quotationNumber: string; lesseeName: string; totalMonthlyRate?: number; totalContractValue?: number; currency?: string; validUntil?: string }): string {
  const currency = q.currency ?? 'AED';
  return `Fleet360 - Lease Quotation ${q.quotationNumber}

Dear ${q.lesseeName},

Please find your lease quotation details below.

Quotation Number : ${q.quotationNumber}
Total Monthly Rate: ${currency} ${(q.totalMonthlyRate ?? 0).toLocaleString('en-AE')}
Total Contract Value: ${currency} ${(q.totalContractValue ?? 0).toLocaleString('en-AE')}
Valid Until: ${q.validUntil ? new Date(q.validUntil).toLocaleDateString('en-AE') : '-'}

Thank you for choosing Fleet360.
`;
}
