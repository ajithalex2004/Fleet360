/**
 * Bilingual Payment Receipt PDF.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export interface ReceiptPdfData {
  receiptNumber: string;
  receivedDate: string | Date;
  amount: number;
  currency: string;
  paymentType: 'DEPOSIT' | 'SECURITY' | 'MONTHLY' | 'ADVANCE' | 'PENALTY' | string;
  paymentMethod?: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'CARD' | string | null;
  chequeNo?: string | null;
  bankRef?: string | null;
  receivedBy?: string | null;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  lessee: {
    name: string; type: 'corporate' | 'individual';
    tradeLicense?: string | null; emiratesId?: string | null;
    email?: string | null; phone?: string | null;
  };
  contractRef?: string | null;
  notes?: string | null;
}

const s = StyleSheet.create({
  page: { paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.xxl, fontSize: typography.body, color: colors.text },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: spacing.lg, marginBottom: spacing.xl, borderBottomWidth: 2, borderBottomColor: colors.primary, borderBottomStyle: 'solid' },
  brand: { flexDirection: 'column' },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary },
  brandContact: { fontSize: typography.micro, color: colors.textMuted, marginTop: spacing.sm },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontSize: typography.h1, fontWeight: 'bold', color: colors.primary, letterSpacing: 1 },
  docMetaRow: { flexDirection: 'row', marginTop: spacing.xs },
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 80 },
  docMetaValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  amountBox: { marginTop: spacing.xl, marginBottom: spacing.xl, padding: spacing.xl, backgroundColor: colors.primary, alignItems: 'center', borderRadius: 4 },
  amountLabel: { fontSize: typography.small, color: colors.white, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 },
  amountValue: { fontSize: typography.display, color: colors.white, fontWeight: 'bold', marginTop: spacing.sm },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: typography.small, fontWeight: 'bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  partyName: { fontSize: typography.large, fontWeight: 'bold', color: colors.text },
  partyMeta: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  detailItem: { width: '50%', paddingVertical: spacing.xs },
  detailLabel: { fontSize: typography.small, color: colors.textMuted },
  detailValue: { fontSize: typography.body, color: colors.text, fontWeight: 'bold', marginTop: 1 },
  thanksBox: { padding: spacing.md, backgroundColor: colors.offwhite, borderLeftWidth: 3, borderLeftColor: colors.success, borderLeftStyle: 'solid' },
  thanksText: { fontSize: typography.small, color: colors.text, lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: spacing.xl, left: spacing.xxl, right: spacing.xxl, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function ReceiptPdf({ data, lang }: { data: ReceiptPdfData; lang: Lang }) {
  const dir = dirFor(lang); const font = fontFor(lang); const ccy = data.currency;
  const ptKey = `pt_${data.paymentType}` as any;
  const pmKey = data.paymentMethod ? `pm_${data.paymentMethod}` as any : null;

  return (
    <Document title={`${t('receipt', lang)} ${data.receiptNumber}`} author={data.vendor.name} creator="Fleet360 Platform">
      <Page size="A4" style={[s.page, { fontFamily: font, direction: dir }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brand}>
            <Text style={[s.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {(data.vendor.address || data.vendor.email) && (
              <Text style={[s.brandContact, { fontFamily: font }]}>{[data.vendor.address, data.vendor.email].filter(Boolean).join(' · ')}</Text>
            )}
            {data.vendor.trn && <Text style={[s.brandContact, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { fontFamily: font }]}>{t('receipt', lang).toUpperCase()}</Text>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('receiptNo', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.receiptNumber}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('receivedDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.receivedDate, lang)}</Text></View>
            {data.contractRef && <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('contractRef', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.contractRef}</Text></View>}
          </View>
        </View>

        {/* Big amount */}
        <View style={s.amountBox}>
          <Text style={[s.amountLabel, { fontFamily: font }]}>{t('amountReceived', lang)}</Text>
          <Text style={[s.amountValue, { fontFamily: font }]}>{formatMoney(data.amount, ccy)}</Text>
        </View>

        {/* Received from */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('receivedFrom', lang)}</Text>
          <View style={s.card}>
            <Text style={[s.partyName, { fontFamily: font }]}>{data.lessee.name}</Text>
            <Text style={[s.partyMeta, { fontFamily: font }]}>{t(data.lessee.type, lang)}</Text>
            {data.lessee.tradeLicense && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('tradeLicense', lang)}: {data.lessee.tradeLicense}</Text>}
            {data.lessee.emiratesId && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('emiratesId', lang)}: {data.lessee.emiratesId}</Text>}
          </View>
        </View>

        {/* Payment details */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('paymentMethod', lang)}</Text>
          <View style={s.card}>
            <View style={s.detailGrid}>
              <View style={s.detailItem}>
                <Text style={[s.detailLabel, { fontFamily: font }]}>{t('paymentType', lang)}</Text>
                <Text style={[s.detailValue, { fontFamily: font }]}>{t(ptKey, lang) ?? data.paymentType}</Text>
              </View>
              {data.paymentMethod && (
                <View style={s.detailItem}>
                  <Text style={[s.detailLabel, { fontFamily: font }]}>{t('paymentMethod', lang)}</Text>
                  <Text style={[s.detailValue, { fontFamily: font }]}>{pmKey ? (t(pmKey, lang) ?? data.paymentMethod) : data.paymentMethod}</Text>
                </View>
              )}
              {data.chequeNo && (
                <View style={s.detailItem}>
                  <Text style={[s.detailLabel, { fontFamily: font }]}>{t('chequeNo', lang)}</Text>
                  <Text style={[s.detailValue, { fontFamily: font }]}>{data.chequeNo}</Text>
                </View>
              )}
              {data.bankRef && (
                <View style={s.detailItem}>
                  <Text style={[s.detailLabel, { fontFamily: font }]}>{t('bankRef', lang)}</Text>
                  <Text style={[s.detailValue, { fontFamily: font }]}>{data.bankRef}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Thanks */}
        <View style={s.section}>
          <View style={s.thanksBox}>
            <Text style={[s.thanksText, { fontFamily: font }]}>{t('receiptThanks', lang)}</Text>
            {data.notes && <Text style={[s.thanksText, { fontFamily: font, marginTop: spacing.sm, color: colors.textMuted }]}>{t('notes', lang)}: {data.notes}</Text>}
          </View>
        </View>

        {/* Page footer */}
        <View style={s.footer} fixed>
          <Text style={[s.footerText, { fontFamily: font }]}>{t('generatedBy', lang)}</Text>
          <Text style={[s.footerText, { fontFamily: font }]} render={({ pageNumber, totalPages }) => `${t('page', lang)} ${pageNumber} ${t('of', lang)} ${totalPages}`} fixed />
        </View>
      </Page>
    </Document>
  );
}
