/**
 * Bilingual quotation PDF template.
 *
 * Usage:
 *   const data = await loadQuotationData(id);
 *   const pdf = await renderPdf(<QuotationPdf data={data} lang="en" />);
 *
 * The template adapts layout direction (LTR / RTL) and font automatically
 * based on the `lang` prop. All copy comes from src/lib/pdf/i18n.ts.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

/* ── Data shape ───────────────────────────────────────────────────────────── */

export interface QuotationVehicle {
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  quantity: number;
  monthlyRate: number;
}

export interface QuotationLine {
  description: string;
  amount: number;
}

export interface QuotationLessee {
  name: string;
  type: 'corporate' | 'individual';
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  tradeLicense?: string | null;
  emiratesId?: string | null;
  trn?: string | null;
}

export interface QuotationPdfData {
  quotationNumber: string;
  quotationDate: string | Date;
  validUntil?: string | Date | null;

  vendor: {
    name: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    trn?: string;
  };

  lessee: QuotationLessee;
  vehicles: QuotationVehicle[];
  lines?: QuotationLine[];

  baseRent: number;
  insurance?: number;
  maintenance?: number;
  driver?: number;
  accessories?: number;
  vatPct?: number;
  currency?: string;

  leaseType?: 'LONG_TERM' | 'SHORT_TERM' | string;
  durationMonths?: number | null;
  mileageCap?: number | null;
  securityDeposit?: number | null;
  notes?: string | null;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function computeTotals(d: QuotationPdfData) {
  const base = d.baseRent ?? 0;
  const ins = d.insurance ?? 0;
  const maint = d.maintenance ?? 0;
  const drv = d.driver ?? 0;
  const acc = d.accessories ?? 0;
  const subtotal = base + ins + maint + drv + acc;
  const vatPct = d.vatPct ?? 5;
  const vat = (subtotal * vatPct) / 100;
  const grand = subtotal + vat;
  return { subtotal, vat, grand };
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

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
  docMetaRow: { flexDirection: 'row', marginTop: spacing.xs },
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 60 },
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

  // Table
  table: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    color: colors.white,
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
    width: 240,
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
    color: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  totalsGrandLabel: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },
  totalsGrandValue: { fontSize: typography.body, color: colors.white, fontWeight: 'bold' },

  // Terms
  termsBox: {
    padding: spacing.md,
    backgroundColor: colors.offwhite,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderLeftStyle: 'solid',
  },
  termsText: { fontSize: typography.small, color: colors.textMuted, lineHeight: 1.5 },

  // Signature
  sigGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxl },
  sigBlock: { width: '45%' },
  sigLabel: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: spacing.xxxl,
  },
  sigLine: { borderTopWidth: 1, borderTopColor: colors.text, borderTopStyle: 'solid', paddingTop: spacing.xs },
  sigName: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },

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

/* ── Component ────────────────────────────────────────────────────────────── */

export function QuotationPdf({ data, lang }: { data: QuotationPdfData; lang: Lang }) {
  const dir = dirFor(lang);
  const font = fontFor(lang);
  const { subtotal, vat, grand } = computeTotals(data);
  const currency = data.currency ?? 'AED';
  const vatPct = data.vatPct ?? 5;

  return (
    <Document
      title={`${t('quotation', lang)} ${data.quotationNumber}`}
      author={data.vendor.name}
      creator="Fleet360 Platform"
      producer="@react-pdf/renderer"
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
            <Text style={[styles.docTitle, { fontFamily: font }]}>{t('quotation', lang).toUpperCase()}</Text>
            <View style={styles.docMetaRow}>
              <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('number', lang)}:</Text>
              <Text style={[styles.docMetaValue, { fontFamily: font }]}>{data.quotationNumber}</Text>
            </View>
            <View style={styles.docMetaRow}>
              <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('date', lang)}:</Text>
              <Text style={[styles.docMetaValue, { fontFamily: font }]}>{formatDate(data.quotationDate, lang)}</Text>
            </View>
            {data.validUntil && (
              <View style={styles.docMetaRow}>
                <Text style={[styles.docMetaLabel, { fontFamily: font }]}>{t('validUntil', lang)}:</Text>
                <Text style={[styles.docMetaValue, { fontFamily: font }]}>{formatDate(data.validUntil, lang)}</Text>
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
            {(data.lessee.tradeLicense || data.lessee.trn) && (
              <Text style={[styles.partyMeta, { fontFamily: font }]}>
                {data.lessee.tradeLicense ? `${t('tradeLicense', lang)}: ${data.lessee.tradeLicense}` : ''}
                {data.lessee.tradeLicense && data.lessee.trn ? ' · ' : ''}
                {data.lessee.trn ? `${t('trn', lang)}: ${data.lessee.trn}` : ''}
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

        {/* VEHICLES */}
        {data.vehicles.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('vehicle', lang)}</Text>
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('make', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('model', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 1 }]}>{t('year', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 1, textAlign: 'right' }]}>{t('qty', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('monthlyRate', lang)}</Text>
                <Text style={[styles.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('subtotal', lang)}</Text>
              </View>
              {data.vehicles.map((v, i) => {
                const lineTotal = v.quantity * v.monthlyRate;
                return (
                  <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                    <Text style={[styles.cellText, { fontFamily: font, flex: 2 }]}>{v.make ?? '—'}</Text>
                    <Text style={[styles.cellText, { fontFamily: font, flex: 2 }]}>{v.model ?? '—'}</Text>
                    <Text style={[styles.cellText, { fontFamily: font, flex: 1 }]}>{v.year ?? '—'}</Text>
                    <Text style={[styles.cellAmount, { fontFamily: font, flex: 1 }]}>{v.quantity}</Text>
                    <Text style={[styles.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(v.monthlyRate, currency)}</Text>
                    <Text style={[styles.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(lineTotal, currency)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* COST SUMMARY */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('total', lang)}</Text>
          <View style={styles.totals}>
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('baseRent', lang)}</Text>
              <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.baseRent, currency)}</Text>
            </View>
            {data.insurance ? (
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('insurance', lang)}</Text>
                <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.insurance, currency)}</Text>
              </View>
            ) : null}
            {data.maintenance ? (
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('maintenance', lang)}</Text>
                <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.maintenance, currency)}</Text>
              </View>
            ) : null}
            {data.driver ? (
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('driver', lang)}</Text>
                <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.driver, currency)}</Text>
              </View>
            ) : null}
            {data.accessories ? (
              <View style={styles.totalsRow}>
                <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('accessories', lang)}</Text>
                <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(data.accessories, currency)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontFamily: font }]}>{t('subtotal', lang)}</Text>
              <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(subtotal, currency)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontFamily: font }]}>
                {lang === 'ar' ? `ضريبة القيمة المضافة (${vatPct}%)` : `VAT (${vatPct}%)`}
              </Text>
              <Text style={[styles.totalsValue, { fontFamily: font }]}>{formatMoney(vat, currency)}</Text>
            </View>
            <View style={styles.totalsGrand}>
              <Text style={[styles.totalsGrandLabel, { fontFamily: font }]}>{t('grandTotal', lang)}</Text>
              <Text style={[styles.totalsGrandValue, { fontFamily: font }]}>{formatMoney(grand, currency)}</Text>
            </View>
          </View>
        </View>

        {/* TERMS */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { fontFamily: font }]}>{t('termsHeading', lang)}</Text>
          <View style={styles.termsBox}>
            <Text style={[styles.termsText, { fontFamily: font }]}>
              {data.leaseType
                ? `${t('leaseType', lang)}: ${
                    data.leaseType === 'LONG_TERM'
                      ? t('longTerm', lang)
                      : data.leaseType === 'SHORT_TERM'
                        ? t('shortTerm', lang)
                        : data.leaseType
                  }`
                : ''}
              {data.durationMonths ? `  ·  ${t('duration', lang)}: ${data.durationMonths} ${t('months', lang)}` : ''}
              {data.mileageCap ? `  ·  ${t('mileageCap', lang)}: ${data.mileageCap.toLocaleString()}` : ''}
              {data.securityDeposit
                ? `  ·  ${t('securityDeposit', lang)}: ${formatMoney(data.securityDeposit, currency)}`
                : ''}
            </Text>
            <Text style={[styles.termsText, { fontFamily: font, marginTop: spacing.sm }]}>
              {t('quotationDisclaimer', lang)}
            </Text>
            {data.notes ? (
              <Text style={[styles.termsText, { fontFamily: font, marginTop: spacing.sm }]}>
                {t('notes', lang)}: {data.notes}
              </Text>
            ) : null}
          </View>
        </View>

        {/* SIGNATURES */}
        <View style={styles.sigGrid}>
          <View style={styles.sigBlock}>
            <Text style={[styles.sigLabel, { fontFamily: font }]}>{t('authorizedSignature', lang)}</Text>
            <View style={styles.sigLine}>
              <Text style={[styles.sigName, { fontFamily: font }]}>{data.vendor.name}</Text>
            </View>
          </View>
          <View style={styles.sigBlock}>
            <Text style={[styles.sigLabel, { fontFamily: font }]}>{t('lesseeAcknowledgment', lang)}</Text>
            <View style={styles.sigLine}>
              <Text style={[styles.sigName, { fontFamily: font }]}>{data.lessee.name}</Text>
            </View>
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
