/**
 * Bilingual Lease Agreement PDF.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export interface ContractVehicleEntry {
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  licensePlate?: string | null;
  vin?: string | null;
  monthlyRate?: number | null;
}

export interface ContractPdfData {
  contractNumber: string;
  agreementType?: string | null;
  leaseType?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  durationMonths?: number | null;
  monthlyRate: number;
  totalContractValue?: number | null;
  mileageCap?: number | null;
  mileageOverageRate?: number | null;
  securityDeposit?: number | null;
  currency: string;
  insuranceIncluded?: boolean;
  maintenanceIncluded?: boolean;
  driverIncluded?: boolean;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  lessee: {
    name: string; type: 'corporate' | 'individual';
    address?: string | null; email?: string | null; phone?: string | null;
    tradeLicense?: string | null; emiratesId?: string | null; trn?: string | null;
  };
  vehicles: ContractVehicleEntry[];
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
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 90 },
  docMetaValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  preamble: { fontSize: typography.small, color: colors.text, lineHeight: 1.5, marginBottom: spacing.xl, padding: spacing.md, backgroundColor: colors.offwhite, borderLeftWidth: 3, borderLeftColor: colors.primary, borderLeftStyle: 'solid' },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: typography.small, fontWeight: 'bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  partyGrid: { flexDirection: 'row', gap: spacing.md },
  partyCard: { flex: 1, padding: spacing.lg, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  partyLabel: { fontSize: typography.small, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
  partyName: { fontSize: typography.large, fontWeight: 'bold', color: colors.text },
  partyMeta: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  termsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  termItem: { width: '33.33%', padding: spacing.sm },
  termLabel: { fontSize: typography.micro, color: colors.textMuted, textTransform: 'uppercase' },
  termValue: { fontSize: typography.body, color: colors.text, fontWeight: 'bold', marginTop: 2 },
  table: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  tableHead: { flexDirection: 'row', backgroundColor: colors.primary, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  tableHeadCell: { color: colors.white, fontSize: typography.small, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  tableRowAlt: { backgroundColor: colors.rowAlt },
  cellText: { fontSize: typography.small, color: colors.text },
  cellAmount: { fontSize: typography.small, color: colors.text, textAlign: 'right' },
  termsBox: { padding: spacing.md, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  termsText: { fontSize: typography.small, color: colors.text, lineHeight: 1.6 },
  sigGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxxl, gap: spacing.xl },
  sigBlock: { flex: 1 },
  sigLabel: { fontSize: typography.small, color: colors.textMuted, marginBottom: spacing.xxxl },
  sigLine: { borderTopWidth: 1, borderTopColor: colors.text, borderTopStyle: 'solid', paddingTop: spacing.xs },
  sigName: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  sigRole: { fontSize: typography.micro, color: colors.textMuted, marginTop: 1 },
  footer: { position: 'absolute', bottom: spacing.xl, left: spacing.xxl, right: spacing.xxl, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function ContractPdf({ data, lang }: { data: ContractPdfData; lang: Lang }) {
  const dir = dirFor(lang); const font = fontFor(lang); const ccy = data.currency;
  const months = data.durationMonths ?? Math.ceil((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / (30.44 * 86400000));

  return (
    <Document title={`${t('contract', lang)} ${data.contractNumber}`} author={data.vendor.name} creator="XL AI Smart Mobility Platform">
      <Page size="A4" style={[s.page, { fontFamily: font, direction: dir }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brand}>
            <Text style={[s.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {data.vendor.address && <Text style={[s.brandContact, { fontFamily: font }]}>{data.vendor.address}</Text>}
            {data.vendor.trn && <Text style={[s.brandContact, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { fontFamily: font }]}>{t('contract', lang).toUpperCase()}</Text>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('contractNo', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.contractNumber}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('startDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.startDate, lang)}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('endDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.endDate, lang)}</Text></View>
          </View>
        </View>

        {/* Preamble */}
        <Text style={[s.preamble, { fontFamily: font }]}>{t('contractPreamble', lang)}</Text>

        {/* Parties */}
        <View style={s.section}>
          <View style={s.partyGrid}>
            <View style={s.partyCard}>
              <Text style={[s.partyLabel, { fontFamily: font }]}>{t('lessor', lang)}</Text>
              <Text style={[s.partyName, { fontFamily: font }]}>{data.vendor.name}</Text>
              {data.vendor.address && <Text style={[s.partyMeta, { fontFamily: font }]}>{data.vendor.address}</Text>}
              {data.vendor.trn && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
            </View>
            <View style={s.partyCard}>
              <Text style={[s.partyLabel, { fontFamily: font }]}>{t('lessee', lang)}</Text>
              <Text style={[s.partyName, { fontFamily: font }]}>{data.lessee.name}</Text>
              <Text style={[s.partyMeta, { fontFamily: font }]}>{t(data.lessee.type, lang)}{data.lessee.address ? ` · ${data.lessee.address}` : ''}</Text>
              {data.lessee.tradeLicense && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('tradeLicense', lang)}: {data.lessee.tradeLicense}</Text>}
              {data.lessee.emiratesId && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('emiratesId', lang)}: {data.lessee.emiratesId}</Text>}
              {data.lessee.trn && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('trn', lang)}: {data.lessee.trn}</Text>}
            </View>
          </View>
        </View>

        {/* Key terms grid */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('total', lang)}</Text>
          <View style={s.termsGrid}>
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('leaseType', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>
                {data.leaseType === 'LONG_TERM' ? t('longTerm', lang) : data.leaseType === 'SHORT_TERM' ? t('shortTerm', lang) : (data.leaseType ?? '—')}
              </Text>
            </View>
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('duration', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>{months} {t('months', lang)}</Text>
            </View>
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('monthlyRate', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>{formatMoney(data.monthlyRate, ccy)}</Text>
            </View>
            {data.mileageCap != null && (
              <View style={s.termItem}>
                <Text style={[s.termLabel, { fontFamily: font }]}>{t('mileageCap', lang)}</Text>
                <Text style={[s.termValue, { fontFamily: font }]}>{data.mileageCap.toLocaleString()}</Text>
              </View>
            )}
            {data.securityDeposit != null && (
              <View style={s.termItem}>
                <Text style={[s.termLabel, { fontFamily: font }]}>{t('securityDeposit', lang)}</Text>
                <Text style={[s.termValue, { fontFamily: font }]}>{formatMoney(data.securityDeposit, ccy)}</Text>
              </View>
            )}
            {data.totalContractValue != null && (
              <View style={s.termItem}>
                <Text style={[s.termLabel, { fontFamily: font }]}>{t('grandTotal', lang)}</Text>
                <Text style={[s.termValue, { fontFamily: font }]}>{formatMoney(data.totalContractValue, ccy)}</Text>
              </View>
            )}
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('insurance', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>{data.insuranceIncluded ? '✓' : '—'}</Text>
            </View>
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('maintenance', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>{data.maintenanceIncluded ? '✓' : '—'}</Text>
            </View>
            <View style={s.termItem}>
              <Text style={[s.termLabel, { fontFamily: font }]}>{t('driver', lang)}</Text>
              <Text style={[s.termValue, { fontFamily: font }]}>{data.driverIncluded ? '✓' : '—'}</Text>
            </View>
          </View>
        </View>

        {/* Vehicle schedule */}
        {data.vehicles.length > 0 && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('vehicleSchedule', lang)}</Text>
            <View style={s.table}>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('make', lang)}</Text>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('model', lang)}</Text>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1 }]}>{t('year', lang)}</Text>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('licensePlate', lang)}</Text>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('vin', lang)}</Text>
                <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('monthlyRate', lang)}</Text>
              </View>
              {data.vehicles.map((v, i) => (
                <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={[s.cellText, { fontFamily: font, flex: 2 }]}>{v.make ?? '—'}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 2 }]}>{v.model ?? '—'}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 1 }]}>{v.year ?? '—'}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 2 }]}>{v.licensePlate ?? '—'}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 2 }]}>{v.vin ?? '—'}</Text>
                  <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{v.monthlyRate != null ? formatMoney(v.monthlyRate, ccy) : '—'}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Terms */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('termsConditions', lang)}</Text>
          <View style={s.termsBox}>
            <Text style={[s.termsText, { fontFamily: font }]}>{t('contractTermsBoilerplate', lang)}</Text>
            {data.notes && <Text style={[s.termsText, { fontFamily: font, marginTop: spacing.md, color: colors.textMuted }]}>{t('notes', lang)}: {data.notes}</Text>}
          </View>
        </View>

        {/* Signatures */}
        <View style={s.sigGrid}>
          <View style={s.sigBlock}>
            <Text style={[s.sigLabel, { fontFamily: font }]}>{t('lessor', lang)} — {t('signature', lang)}</Text>
            <View style={s.sigLine}>
              <Text style={[s.sigName, { fontFamily: font }]}>{data.vendor.name}</Text>
              <Text style={[s.sigRole, { fontFamily: font }]}>{t('representative', lang)}</Text>
            </View>
          </View>
          <View style={s.sigBlock}>
            <Text style={[s.sigLabel, { fontFamily: font }]}>{t('lessee', lang)} — {t('signature', lang)}</Text>
            <View style={s.sigLine}>
              <Text style={[s.sigName, { fontFamily: font }]}>{data.lessee.name}</Text>
              <Text style={[s.sigRole, { fontFamily: font }]}>{t('representative', lang)}</Text>
            </View>
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
