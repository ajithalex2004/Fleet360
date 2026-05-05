import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import nodemailer from 'nodemailer';
import { quotationEmailHtml, quotationEmailText } from '@/lib/email-templates/quotation';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 1. Fetch full quotation with lessee
    const quotation = await prisma.leaseQuotation.findUnique({
      where: { id: params.id },
      include: {
        lessee:   true,
        vehicles: true,
        lineItems: true,
      },
    });
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const recipientEmail = body.recipientEmail
      || (quotation.lessee as any)?.email
      || null;

    // 2. Update status to SENT_TO_CUSTOMER
    await prisma.leaseQuotation.update({
      where: { id: params.id },
      data:  { status: 'SENT_TO_CUSTOMER', updatedAt: new Date() },
    });

    // 3. Try to send email if SMTP is configured
    let emailResult: { sent: boolean; message: string; recipient?: string } = {
      sent: false,
      message: 'No SMTP configuration found. Quotation status updated to SENT_TO_CUSTOMER.',
    };

    try {
      const emailConfig = await prisma.integrationConfig.findFirst({
        where: { type: 'EMAIL', isEnabled: true },
      });

      if (emailConfig && emailConfig.host && emailConfig.username) {
        const transport = nodemailer.createTransport({
          host:   emailConfig.host,
          port:   parseInt(emailConfig.port ?? '587'),
          secure: (emailConfig.encryption ?? '').toUpperCase() === 'SSL',
          auth: {
            user: emailConfig.username,
            pass: emailConfig.password ?? '',
          },
          tls: { rejectUnauthorized: false },
        });

        const lesseeName  = (quotation.lessee as any)?.name ?? 'Valued Customer';
        const contactEmail = emailConfig.senderEmail ?? emailConfig.username;

        const htmlBody = quotationEmailHtml({
          quotationNumber:    quotation.quotationNumber ?? params.id,
          lesseeName,
          lesseeEmail:        recipientEmail,
          leaseType:          quotation.leaseType ?? 'LONG_TERM',
          durationMonths:     quotation.durationMonths ?? undefined,
          startDate:          quotation.startDate?.toISOString(),
          endDate:            quotation.endDate?.toISOString(),
          validUntil:         quotation.validUntil?.toISOString(),
          currency:           quotation.currency ?? 'AED',
          totalMonthlyRate:   Number(quotation.totalMonthlyRate ?? 0),
          totalContractValue: Number(quotation.totalContractValue ?? 0),
          securityDeposit:    Number(quotation.securityDeposit ?? 0),
          mileageCap:         quotation.mileageCap ?? undefined,
          insuranceIncluded:  quotation.insuranceIncluded ?? false,
          maintenanceIncluded: quotation.maintenanceIncluded ?? false,
          driverIncluded:     quotation.driverIncluded ?? false,
          vehicles:           (quotation.vehicles as any[]).map(v => ({
            vehicleType: v.vehicleType,
            make:        v.make,
            model:       v.model,
            year:        v.year,
            quantity:    Number(v.quantity ?? 1),
            monthlyRate: Number(v.monthlyRate ?? 0),
          })),
          notes:        quotation.notes ?? undefined,
          companyName:  emailConfig.fromName  ?? 'XL AI Smart Mobility',
          contactEmail,
        });

        const textBody = quotationEmailText({
          quotationNumber:    quotation.quotationNumber ?? params.id,
          lesseeName,
          totalMonthlyRate:   Number(quotation.totalMonthlyRate ?? 0),
          totalContractValue: Number(quotation.totalContractValue ?? 0),
          currency:           quotation.currency ?? 'AED',
          validUntil:         quotation.validUntil?.toISOString(),
        });

        const toAddress = recipientEmail || contactEmail;

        await transport.sendMail({
          from:    `"${emailConfig.fromName ?? 'XL AI Smart Mobility'}" <${emailConfig.senderEmail ?? emailConfig.username}>`,
          to:      toAddress,
          subject: `Lease Quotation ${quotation.quotationNumber ?? params.id} - XL AI Smart Mobility`,
          text:    textBody,
          html:    htmlBody,
        });

        emailResult = {
          sent:      true,
          message:   `Quotation emailed successfully to ${toAddress}`,
          recipient: toAddress,
        };
      } else {
        emailResult.message = emailConfig
          ? 'Email config found but SMTP host/credentials not set. Quotation marked as SENT_TO_CUSTOMER.'
          : 'No EMAIL integration configured. Go to Admin > Integrations to set up SMTP. Quotation status updated.';
      }
    } catch (emailErr: any) {
      console.error('Email send error:', emailErr);
      emailResult = {
        sent:    false,
        message: `Quotation status updated but email failed: ${emailErr?.message ?? 'SMTP error'}`,
      };
    }

    return NextResponse.json({
      success:       true,
      quotationId:   params.id,
      status:        'SENT_TO_CUSTOMER',
      email:         emailResult,
    });

  } catch (e: any) {
    console.error('Submit quotation error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to submit quotation' }, { status: 500 });
  }
}
