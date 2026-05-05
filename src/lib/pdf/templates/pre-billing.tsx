/**
 * Bilingual pre-billing statement PDF.
 *
 * Layout:
 *  - Header band with vendor branding + statement number / period / due date
 *  - Bill-to card (lessee)
 *  - Optional itemised detail table (line items pulled from sources)
 *  - Charge summary (base + fuel + fines + maintenance + overage + other) + VAT
 *  - Review-window disclaimer
 *  - Footer
 *
 * Render via:
 *   const buffer = await renderPdf(createElement(PreBillingPdf, { data, lang }));
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export interface PreBillingLineRef {
  source: 'fuel' | 'fine' | 'overage';
  date: string;
  amount: number;
  description: string;
}

export interface PreBillingPdfData {
  statementNo: string;
  billingPeriod: string;
  dueDate: string | Date;
  periodFrom: string | Date;
  periodTo: string | Date;

  vendor: {
    name: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    trn?: string;
  };

  lessee: {
    name: string;
    type: 'corporate' | 'individual';
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    tradeLicense?: string | null;
    emiratesId?: string | null;
  };

  contractRef?: string | null;

  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;

  /** Optional itemised line refs to print before the summary table. */
  sources?: PreBillingLineRef[];
}

const styles = StyleSheet.create({
  page: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    fontSize: typography.body,
    color: colors.text,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: spacing.lg,
    marginBottom: spacing.xl,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    borderBottomStyle: 'solid',
  },
  brand: { flexDirection: 'column' },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary },
  brandTagline: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  brandContact: { fontSize: typography.micro, color: colors.textMuted, marginTop: spacing.sm },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontSize: typography.h1, fontWeight: 'bold', color: colors.primary, letterSpacing: 1 },
  docSubtitle: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  docMetaRow: { flexDirection: 'row', marginTop: spacing.xs },
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 80 },
  docMetaValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },

  // Section
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontSize: typography.small,
    fontWeight: 'bold',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.lg,
    backgroundColor: colors.offwhite,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'solid',
    borderRadius: 4,
  },
  partyName: { fontSize: typography.large, fontWeight: 'bold', color: colors.text },
  partyMeta: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },

  // Itemised table
  table: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tableHeadCell: { color: colors.white, fontSize: typography.small, fontWeight: 'bold' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
  },
  tableRowAlt: { backgroundColor: colors.rowAlt },
  cellText: { fontSize: typography.small, color: colors.text },
  cellAmount: { fontSize: typography.small, color: colors.text, textAlign: 'right' },

  // Totals box
  totals: {
    marginTop: spacing.md,
    alignSelf: 'flex-end',
    width: 260,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'solid',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
  },
  totalsLabel: { fontSize: typography.small, color: colors.textMuted },
  totalsValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  totalsGrand: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  totalsGrandLabel: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },
  totalsGrandValue: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },

  // Disclaimer
  disclaimer: {
    padding: spacing.md,
    backgroundColor: colors.offwhite,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderLeftStyle: 'solid',
  },
  disclaimerText: { fontSize: typography.small, color: colors.textMuted, lineHeight: 1.5 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.xxl,
    right: spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
  },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function PreBillingPdf({ data, lang }: { data: PreBillingPdfData; lang: Lang }) {
  const dir = dirFor(lang);
  const font = fontFor(lang);
  const currency = data.currency;

  const summaryRows: { label: string; value: number }[] = [
    { label: t('baseRent', lang), value: data.baseRent },
    { label: t('fuelCharges', lang), value: data.fuelCharges },
    { label: t('fineCharges', lang), value: data.fineCharges },
    { label: t('maintenance', lang), value: data.maintenanceCharges },
    { label: t('overageCharges', lang), value: data.overageCharges },
    { label: t('otherCharges', lang), value: data.otherCharges },
  ].filter(r => r.value > 0);

  return (
    <Document
      title={`${t('statement', lang)} ${data.statementNo}`}
      author={data.vendor.name}
      creator="XL AI Smart Mobility Platform"
    >
      <Page size="A4" style={[styles.page, { fontFamily: font, direction: dir }]}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <Text style={[styles.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {data.vendor.tagline && (
              <Text style={[styles.brandTagline, { fontFamily: font }]}>{data.vendor.tagline}</Text>
            )}
            {(data.vendor.address || data.vendor.phone || data.vendor.email) && (
              <Text style={[styles.brandContact, { fontFamily: font }]}>
                {[data.vendor.address, data.vendor.phone, data.vendor.email].filter(Boolean).join(' · ')}
              </Text>
            )}
            {data.vendor.trn && (
              <Text style={[styles.brandContact, { fontFamily: font }]}>
                {t('trn', lang)}: {data.vendor.trn}
              </Text>
            )}
          </View>
          <View style={styles.docMeta}>
            <Text style={[styles.docTitle, { fontFamily: font }]}>{t('statement', lang).toUpperCase()}</Text>
            <Text style={[styles.docSubtitle, { fontFamily: font }]}>{lang === 'ar' ? '— فوترة مسبقة' : '— Pre-billing'}</Text>
            <View style={styles.docMetaRow}>
              <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('number', lang)}:</Text>
              <Text style={[styles.docMetaValue, { fontFamily: font }]}>{data.statementNo}</Text>
            </View>
            <View style={styles.docMetaRow}>
              <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('billingPeriod', lang)}:</Text>
              <Text style={[styles.docMetaValue, { fontFamily: font }]}>{data.billingPeriod}</Text>
            </View>
            <View style={styles.docMetaRow}>
              <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('dueDate', lang)}:</Text>
              <Text style={[styles.docMetaValue, { fontFamily: font }]}>{formatDate(data.dueDate, lang)}</Text>
            </View>
            {data.contractRef && (
              <View style={styles.docMetaRow}>
                <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('contractRef', lang)}:</Text>
                <Text style={[styles.docMetaValue, { fontFamily: font }]}>{data.contractRef}</Text>
              </View>
            )}
          </View>
        </View>

        {/* BILL TO */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('billTo', lang)}</Text>
          <View style={styles.card}>
            <Text style={[styles.partyName, { fontFamily: font }]}>{data.lessee.name}</Text>
            <Text style={[styles.partyMeta, { fontFamily: font }]}>
              {t(data.lessee.type, lang)}
              {data.lessee.address ? ` · ${data.lessee.address}` : ''}
            </Text>
            {data.lessee.tradeLicense && (
              <Text style={[styles.partyMeta, { fontFamily: font }]}>
                {t('tradeLicense', lang)}: {data.lessee.tradeLicense}
              </Text>
            )}
            {data.lessee.emiratesId && (
              <Text style={[styles.partyMeta, { fontFamily: font }]}>
                {t('emiratesId', lang)}: {data.lessee.emiratesId}
              </Text>
            )}
            {(data.lessee.phone || data.lessee.email) && (
              <Text style={[styles.partyMeta, { fontFamily: font }]}>
                {[data.lessee.phone, data.lessee.email].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
        </View>

        {/* ITEMISED DETAIL */}
        {data.sources && data.sources.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('itemisedDetail', lang)}</Text>
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 1.2 }]}>{t('date', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 4 }]}>{t('description', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 1.5, textAlign: 'right' }]}>{t('amount', lang)}</Text>
              </View>
              {data.sources.map((s, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                  <Text style={[styles.cellText, { fontFamily: font, flex: 1.2 }]}>
                    {formatDate(s.date, lang)}
                  </Text>
                  <Text style={[styles.cellText, { fontFamily: font, flex: 4 }]}>{s.description}</Text>
                  <Text style={[styles.cellAmount, { fontFamily: font, flex: 1.5 }]}>
                    {formatMoney(s.amount, currency)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* CHARGE SUMMARY */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('total', lang)}</Text>
          <View style={styles.totals}>
            {summaryRows.map((r, i) => (
              <View key={i} style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { fontFamily: font }]}>{r.label}</Text>
                <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(r.value, currency)}</Text>
              </View>
            ))}
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontFamily: font }]}>
                {lang === 'ar' ? `ضريبة القيمة المضافة (${data.vatPct}%)` : `VAT (${data.vatPct}%)`}
              </Text>
              <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.vatAmount, currency)}</Text>
            </View>
            <View style={styles.totalsGrand}>
              <Text style={[styles.totalsGrandLabel, { fontFamily: font }]}>{t('grandTotal', lang)}</Text>
              <Text style={[styles.totalsGrandValue, { fontFamily: font }]}>{formatMoney(data.totalAmount, currency)}</Text>
            </View>
          </View>
        </View>

        {/* DISCLAIMER */}
        <View style={styles.section}>
          <View style={styles.disclaimer}>
            <Text style={[styles.disclaimerText, { fontFamily: font }]}>
              {t('reviewWindowNote', lang)}
            </Text>
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, { fontFamily: font }]}>{t('generatedBy', lang)}</Text>
          <Text
            style={[styles.footerText, { fontFamily: font }]}
            render={({ pageNumber, totalPages }) =>
              `${t('page', lang)} ${pageNumber} ${t('of', lang)} ${totalPages}`
            }
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}
