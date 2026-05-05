/**
 * Bilingual RAC Rental Agreement PDF.
 * The document the customer signs at handover.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export interface AgreementCharge {
  description: string;
  quantity?: number;
  unitLabel?: string;
  unitPrice?: number;
  totalAmount: number;
  lineType?: string;
}

export interface RentalAgreementPdfData {
  agreementNo: string;
  bookingRef?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  totalDays: number;
  pickupBranch?: string | null;
  dropoffBranch?: string | null;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  customer: {
    name: string;
    customerType?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
    drivingLicenseNo?: string | null;
    passportNo?: string | null;
    tradeLicense?: string | null;
    vatNumber?: string | null;
  };
  vehicle: {
    make?: string | null;
    model?: string | null;
    year?: number | null;
    licensePlate?: string | null;
    vin?: string | null;
    color?: string | null;
    category?: string | null;
  };
  dailyRate: number;
  baseRentalCharge: number;
  insuranceTier?: string | null;
  insuranceCharge?: number;
  charges?: AgreementCharge[];
  ancillariesTotal?: number;
  subTotal: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;
  securityDeposit?: number | null;
  currency: string;
  mileageIn?: number | null;
  mileageOut?: number | null;
  fuelIn?: number | null;
  fuelOut?: number | null;
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
  card: { padding: spacing.lg, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  vehGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  vehItem: { width: '33.33%', padding: spacing.sm },
  vehLabel: { fontSize: typography.micro, color: colors.textMuted, textTransform: 'uppercase' },
  vehValue: { fontSize: typography.body, color: colors.text, fontWeight: 'bold', marginTop: 2 },
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
  termsBox: { padding: spacing.md, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  termsText: { fontSize: typography.small, color: colors.text, lineHeight: 1.6 },
  sigGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxxl, gap: spacing.xl },
  sigBlock: { flex: 1 },
  sigLabel: { fontSize: typography.small, color: colors.textMuted, marginBottom: spacing.xxxl },
  sigLine: { borderTopWidth: 1, borderTopColor: colors.text, borderTopStyle: 'solid', paddingTop: spacing.xs },
  sigName: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  footer: { position: 'absolute', bottom: spacing.xl, left: spacing.xxl, right: spacing.xxl, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function RentalAgreementPdf({ data, lang }: { data: RentalAgreementPdfData; lang: Lang }) {
  const dir = dirFor(lang); const font = fontFor(lang); const ccy = data.currency;

  return (
    <Document title={`${t('rentalAgreement', lang)} ${data.agreementNo}`} author={data.vendor.name} creator="XL AI Smart Mobility Platform">
      <Page size="A4" style={[s.page, { fontFamily: font, direction: dir }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brand}>
            <Text style={[s.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {data.vendor.address && <Text style={[s.brandContact, { fontFamily: font }]}>{data.vendor.address}</Text>}
            {data.vendor.trn && <Text style={[s.brandContact, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { fontFamily: font }]}>{t('rentalAgreement', lang).toUpperCase()}</Text>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('agreementNo', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.agreementNo}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('pickupDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.startDate, lang)}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('dropoffDate', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.endDate, lang)}</Text></View>
            <View style={s.docMetaRow}><Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('totalDays', lang)}:</Text><Text style={[s.docMetaValue, { fontFamily: font }]}>{data.totalDays}</Text></View>
          </View>
        </View>

        <Text style={[s.preamble, { fontFamily: font }]}>{t('rentalAgreementPreamble', lang)}</Text>

        {/* Parties */}
        <View style={s.section}>
          <View style={s.partyGrid}>
            <View style={s.partyCard}>
              <Text style={[s.partyLabel, { fontFamily: font }]}>{t('rentalCompany', lang)}</Text>
              <Text style={[s.partyName, { fontFamily: font }]}>{data.vendor.name}</Text>
              {data.vendor.address && <Text style={[s.partyMeta, { fontFamily: font }]}>{data.vendor.address}</Text>}
              {data.vendor.trn && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
              {data.pickupBranch && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('pickupBranch', lang)}: {data.pickupBranch}</Text>}
              {data.dropoffBranch && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('dropoffBranch', lang)}: {data.dropoffBranch}</Text>}
            </View>
            <View style={s.partyCard}>
              <Text style={[s.partyLabel, { fontFamily: font }]}>{t('renter', lang)}</Text>
              <Text style={[s.partyName, { fontFamily: font }]}>{data.customer.name}</Text>
              {data.customer.address && <Text style={[s.partyMeta, { fontFamily: font }]}>{data.customer.address}</Text>}
              {data.customer.drivingLicenseNo && <Text style={[s.partyMeta, { fontFamily: font }]}>DL: {data.customer.drivingLicenseNo}</Text>}
              {data.customer.passportNo && <Text style={[s.partyMeta, { fontFamily: font }]}>Passport: {data.customer.passportNo}</Text>}
              {data.customer.nationality && <Text style={[s.partyMeta, { fontFamily: font }]}>{data.customer.nationality}</Text>}
              {data.customer.tradeLicense && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('tradeLicense', lang)}: {data.customer.tradeLicense}</Text>}
              {data.customer.vatNumber && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('trn', lang)}: {data.customer.vatNumber}</Text>}
              {(data.customer.phone || data.customer.email) && <Text style={[s.partyMeta, { fontFamily: font }]}>{[data.customer.phone, data.customer.email].filter(Boolean).join(' · ')}</Text>}
            </View>
          </View>
        </View>

        {/* Vehicle */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('rentalVehicle', lang)}</Text>
          <View style={s.card}>
            <View style={s.vehGrid}>
              <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('make', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.make ?? '—'}</Text></View>
              <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('model', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.model ?? '—'}</Text></View>
              <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('year', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.year ?? '—'}</Text></View>
              <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('licensePlate', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.licensePlate ?? '—'}</Text></View>
              <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('vin', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.vin ?? '—'}</Text></View>
              {data.vehicle.color && <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>Color</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.vehicle.color}</Text></View>}
              {data.mileageIn != null && <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('mileageIn', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.mileageIn.toLocaleString()} km</Text></View>}
              {data.mileageOut != null && <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('mileageOut', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.mileageOut.toLocaleString()} km</Text></View>}
              {data.fuelIn != null && <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('fuelIn', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.fuelIn}/8</Text></View>}
              {data.fuelOut != null && <View style={s.vehItem}><Text style={[s.vehLabel, { fontFamily: font }]}>{t('fuelOut', lang)}</Text><Text style={[s.vehValue, { fontFamily: font }]}>{data.fuelOut}/8</Text></View>}
            </View>
          </View>
        </View>

        {/* Charges */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('rentalCharges', lang)}</Text>
          <View style={s.table}>
            <View style={s.tableHead}>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 5 }]}>{t('description', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1, textAlign: 'right' }]}>{t('qty', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('unitPrice', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2, textAlign: 'right' }]}>{t('total', lang)}</Text>
            </View>
            <View style={s.tableRow}>
              <Text style={[s.cellText, { fontFamily: font, flex: 5 }]}>{`${t('rentalVehicle', lang)} — ${data.totalDays} ${data.totalDays === 1 ? 'day' : 'days'}`}</Text>
              <Text style={[s.cellAmount, { fontFamily: font, flex: 1 }]}>{data.totalDays}</Text>
              <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(data.dailyRate, ccy)}</Text>
              <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(data.baseRentalCharge, ccy)}</Text>
            </View>
            {data.insuranceCharge != null && data.insuranceCharge > 0 && (
              <View style={[s.tableRow, s.tableRowAlt]}>
                <Text style={[s.cellText, { fontFamily: font, flex: 5 }]}>{`${t('insuranceTier', lang)}${data.insuranceTier ? ` — ${data.insuranceTier}` : ''}`}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 1 }]}>—</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>—</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(data.insuranceCharge, ccy)}</Text>
              </View>
            )}
            {(data.charges ?? []).map((c, i) => (
              <View key={i} style={[s.tableRow, (i + (data.insuranceCharge ? 1 : 0)) % 2 === 0 ? s.tableRowAlt : {}]}>
                <Text style={[s.cellText, { fontFamily: font, flex: 5 }]}>{c.description}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 1 }]}>{c.quantity ?? '—'}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{c.unitPrice != null ? formatMoney(c.unitPrice, ccy) : '—'}</Text>
                <Text style={[s.cellAmount, { fontFamily: font, flex: 2 }]}>{formatMoney(c.totalAmount, ccy)}</Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={s.totals}>
            <View style={s.totalsRow}>
              <Text style={[s.totalsLabel, { fontFamily: font }]}>{t('subtotal', lang)}</Text>
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
          {data.securityDeposit != null && data.securityDeposit > 0 && (
            <View style={[{ marginTop: spacing.sm, alignSelf: 'flex-end', padding: spacing.sm, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', flexDirection: 'row', gap: spacing.md }]}>
              <Text style={[s.totalsLabel, { fontFamily: font }]}>{t('securityDeposit', lang)}:</Text>
              <Text style={[s.totalsValue, { fontFamily: font, color: colors.warning }]}>{formatMoney(data.securityDeposit, ccy)}</Text>
            </View>
          )}
        </View>

        {/* Terms */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('termsConditions', lang)}</Text>
          <View style={s.termsBox}>
            <Text style={[s.termsText, { fontFamily: font }]}>{t('rentalTermsBoilerplate', lang)}</Text>
            {data.notes && <Text style={[s.termsText, { fontFamily: font, marginTop: spacing.md, color: colors.textMuted }]}>{t('notes', lang)}: {data.notes}</Text>}
          </View>
        </View>

        {/* Signatures */}
        <View style={s.sigGrid}>
          <View style={s.sigBlock}>
            <Text style={[s.sigLabel, { fontFamily: font }]}>{t('rentalCompany', lang)} — {t('signature', lang)}</Text>
            <View style={s.sigLine}>
              <Text style={[s.sigName, { fontFamily: font }]}>{data.vendor.name}</Text>
            </View>
          </View>
          <View style={s.sigBlock}>
            <Text style={[s.sigLabel, { fontFamily: font }]}>{t('renter', lang)} — {t('signature', lang)}</Text>
            <View style={s.sigLine}>
              <Text style={[s.sigName, { fontFamily: font }]}>{data.customer.name}</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={[s.footerText, { fontFamily: font }]}>{t('generatedBy', lang)}</Text>
          <Text style={[s.footerText, { fontFamily: font }]} render={({ pageNumber, totalPages }) => `${t('page', lang)} ${pageNumber} ${t('of', lang)} ${totalPages}`} fixed />
        </View>
      </Page>
    </Document>
  );
}
