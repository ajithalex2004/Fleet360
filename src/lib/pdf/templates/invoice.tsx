/**
 * Bilingual Tax Invoice PDF (FTA-compliant header — TRN, VAT 5%, AED).
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export interface InvoiceLine {
  description: string;
  quantity?: number | null;
  unitAmount?: number;
  totalAmount: number;
  lineType?: string | null;
}

export interface InvoicePdfData {
  invoiceNo: string;
  issueDate: string | Date;
  dueDate: string | Date;
  billingPeriod?: string | null;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  lessee: {
    name: string; type: 'corporate' | 'individual';
    address?: string | null; email?: string | null; phone?: string | null;
    tradeLicense?: string | null; emiratesId?: string | null; trn?: string | null;
  };
  contractRef?: string | null;
  lines: InvoiceLine[];
  subTotal: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  notes?: string | null;
}

const s = StyleSheet.create({
  page: { paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.xxl, fontSize: typography.body, color: colors.text },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: spacing.lg, marginBottom: spacing.xl, borderBottomWidth: 2, borderBottomColor: colors.primary, borderBottomStyle: 'solid' },
  brand: { flexDirection: 'column' },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary },
  brandTagline: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  brandContact: { fontSize: typography.micro, color: colors.textMuted, marginTop: spacing.sm },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontSize: typography.h1, fontWeight: 'bold', color: colors.primary, letterSpacing: 1 },
  docMetaRow: { flexDirection: 'row', marginTop: spacing.xs },
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 80 },
  docMetaValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: typography.small, fontWeight: 'bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  partyName: { fontSize: typography.large, fontWeight: 'bold', color: colors.text },
  partyMeta: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  table: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  tableHead: { flexDirection: 'row', backgroundColor: colors.primary, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  tableHeadCell: { color: colors.white, fontSize: typography.small, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  tableRowAlt: { backgroundColor: colors.rowAlt },
  cellText: { fontSize: typography.small, color: colors.text },
  cellAmount: { fontSize: typography.small, color: colors.text, textAlign: 'right' },
  totals: { marginTop: spacing.md, alignSelf: 'flex-end', width: 280, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, borderBottomStyle: 'solid' },
  totalsLabel: { fontSize: typography.small, color: colors.textMuted },
  totalsValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  totalsGrand: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.md, flexDirection: 'row', justifyContent: 'space-between' },
  totalsGrandLabel: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },
  totalsGrandValue: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },
  noteBox: { padding: spacing.md, backgroundColor: colors.offwhite, borderLeftWidth: 3, borderLeftColor: colors.accent, borderLeftStyle: 'solid' },
  noteText: { fontSize: typography.small, color: colors.textMuted, lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: spacing.xl, left: spacing.xxl, right: spacing.xxl, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function InvoicePdf({ data, lang }: { data: InvoicePdfData; lang: Lang }) {
  const dir = dirFor(lang); const font = fontFor(lang); const ccy = data.currency;

  return (
    <Document title={`${t('invoice', lang)} ${data.invoiceNo}`} author={data.vendor.name} creator="Fleet360 Platform">
      <Page size="A4" style={[s.page, { fontFamily: font, direction: dir }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brand}>
            <Text style={[s.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {data.vendor.tagline && <Text style={[s.brandTagline, { fontFamily: font }]}>{data.vendor.tagline}</Text>}
            {(data.vendor.address || data.vendor.phone || data.vendor.email) && (
              <Text style={[s.brandContact, { fontFamily: font }]}>
                {[data.vendor.address, data.vendor.phone, data.vendor.email].filter(Boolean).join(' · ')}
              </Text>
            )}
            {data.vendor.trn && <Text style={[s.brandContact, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { fontFamily: font }]}>{t('invoice', lang).toUpperCase()}</Text>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('invoiceNo', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.invoiceNo}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('issueDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.issueDate, lang)}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('dueDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.dueDate, lang)}</Text></View>
            {data.billingPeriod && <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('billingPeriod', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.billingPeriod}</Text></View>}
            {data.contractRef && <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('contractRef', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.contractRef}</Text></View>}
          </View>
        </View>

        {/* Bill to */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('billTo', lang)}</Text>
          <View style={s.card}>
            <Text style={[s.partyName, { fontFamily: font }]}>{data.lessee.name}</Text>
            <Text style={[s.partyMeta, { fontFamily: font }]}>{t(data.lessee.type, lang)}{data.lessee.address ? ` · ${data.lessee.address}` : ''}</Text>
            {(data.lessee.tradeLicense || data.lessee.trn) && (
              <Text style={[s.partyMeta, { fontFamily: font }]}>
                {data.lessee.tradeLicense ? `${t('tradeLicense', lang)}: ${data.lessee.tradeLicense}` : ''}
                {data.lessee.tradeLicense && data.lessee.trn ? ' · ' : ''}
                {data.lessee.trn ? `${t('trn', lang)}: ${data.lessee.trn}` : ''}
              </Text>
            )}
            {data.lessee.emiratesId && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('emiratesId', lang)}: {data.lessee.emiratesId}</Text>}
            {(data.lessee.phone || data.lessee.email) && <Text style={[s.partyMeta, { fontFamily: font }]}>{[data.lessee.phone, data.lessee.email].filter(Boolean).join(' · ')}</Text>}
          </View>
        </View>

        {/* Lines */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('description', lang)}</Text>
          <View style={s.table}>
            <View style={s.tableHead}>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 5 }]}>{t('description', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1, textAlign: 'right' }]}>{t('qty', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('unitPrice', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('total', lang)}</Text>
            </View>
            {data.lines.map((l, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                <Text style={[s.cellText, { fontFamily: font, flex: 5 }]}>{l.description}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 1 }]}>{l.quantity ?? '—'}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{l.unitAmount != null ? formatMoney(l.unitAmount, ccy) : '—'}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(l.totalAmount, ccy)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={s.section}>
          <View style={s.totals}>
            <View style={s.totalsRow}>
              <Text style={[s.totalsLabel, { fontFamily: font }]}>{t('taxableSupplies', lang)}</Text>
              <Text style={[s.totalsValue, { fontFamily: font }]}>{formatMoney(data.subTotal, ccy)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={[s.totalsLabel, { fontFamily: font }]}>{lang === 'ar' ? `ضريبة القيمة المضافة (${data.vatPct}%)` : `VAT (${data.vatPct}%)`}</Text>
              <Text style={[s.totalsValue, { fontFamily: font }]}>{formatMoney(data.vatAmount, ccy)}</Text>
            </View>
            <View style={s.totalsGrand}>
              <Text style={[s.totalsGrandLabel, { fontFamily: font }]}>{t('grandTotal', lang)}</Text>
              <Text style={[s.totalsGrandValue, { fontFamily: font }]}>{formatMoney(data.totalAmount, ccy)}</Text>
            </View>
          </View>
        </View>

        {/* Footer note */}
        <View style={s.section}>
          <View style={s.noteBox}>
            <Text style={[s.noteText, { fontFamily: font, fontWeight: 'bold' }]}>{t('paymentTerms', lang)}: {t('thirtyDays', lang)}</Text>
            <Text style={[s.noteText, { fontFamily: font, marginTop: spacing.xs }]}>{t('invoiceFooter', lang)}</Text>
            {data.notes && <Text style={[s.noteText, { fontFamily: font, marginTop: spacing.sm }]}>{t('notes', lang)}: {data.notes}</Text>}
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
