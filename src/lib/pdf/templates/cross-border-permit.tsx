/**
 * Bilingual Cross-Border Travel Permit PDF.
 * Required when a UAE-rented vehicle is driven into Oman, KSA, Bahrain, Qatar, or Kuwait.
 * Customer presents this at the border with rental agreement + mulkiya + DL.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatDate } from '../theme';
import { t } from '../i18n';

export interface CrossBorderPermitPdfData {
  permitNo: string;
  issueDate: string | Date;
  validFrom: string | Date;
  validUntil: string | Date;
  destinationCountry: string;
  borderCrossing?: string | null;
  routeOfTravel?: string | null;
  purposeOfTravel?: string | null;
  rentalAgreementRef?: string | null;
  bookingRef?: string | null;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  renter: {
    name: string;
    nationality?: string | null;
    drivingLicenseNo?: string | null;
    passportNo?: string | null;
    emiratesId?: string | null;
    phone?: string | null;
  };
  vehicle: {
    make?: string | null;
    model?: string | null;
    year?: number | null;
    licensePlate?: string | null;
    vin?: string | null;
    color?: string | null;
  };
}

const s = StyleSheet.create({
  page: { paddingTop: spacing.xxl, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.xxl, fontSize: typography.body, color: colors.text },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: spacing.lg, marginBottom: spacing.xl, borderBottomWidth: 2, borderBottomColor: colors.primary, borderBottomStyle: 'solid' },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary },
  brandContact: { fontSize: typography.micro, color: colors.textMuted, marginTop: spacing.sm },
  docTitle: { fontSize: typography.h1, fontWeight: 'bold', color: colors.primary, letterSpacing: 1 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docMetaRow: { flexDirection: 'row', marginTop: spacing.xs },
  docMetaLabel: { fontSize: typography.small, color: colors.textMuted, minWidth: 90 },
  docMetaValue: { fontSize: typography.small, color: colors.text, fontWeight: 'bold' },
  declaration: { fontSize: typography.small, color: colors.text, lineHeight: 1.5, marginBottom: spacing.xl, padding: spacing.md, backgroundColor: colors.offwhite, borderLeftWidth: 3, borderLeftColor: colors.primary, borderLeftStyle: 'solid' },
  sectionTitle: { fontSize: typography.large, fontWeight: 'bold', color: colors.primary, marginBottom: spacing.sm, marginTop: spacing.lg },
  panel: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', padding: spacing.md, marginBottom: spacing.md, borderRadius: 4 },
  row: { flexDirection: 'row', marginBottom: spacing.xs },
  label: { fontSize: typography.small, color: colors.textMuted, width: '40%' },
  value: { fontSize: typography.small, color: colors.text, width: '60%', fontWeight: 'bold' },
  validityBlock: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b', borderStyle: 'solid', padding: spacing.md, marginBottom: spacing.lg, borderRadius: 4 },
  validityCell: { flex: 1, alignItems: 'center' },
  validityLabel: { fontSize: typography.micro, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5 },
  validityValue: { fontSize: typography.h3, fontWeight: 'bold', color: '#78350f', marginTop: spacing.xs },
  destinationBanner: { backgroundColor: colors.primary, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg, borderRadius: 4 },
  destinationLabel: { fontSize: typography.micro, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: 1 },
  destinationValue: { fontSize: typography.h2, fontWeight: 'bold', color: colors.white, marginTop: spacing.xs },
  conditions: { fontSize: typography.small, color: colors.text, lineHeight: 1.6, marginTop: spacing.md, padding: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, borderLeftStyle: 'solid' },
  conditionsTitle: { fontSize: typography.small, fontWeight: 'bold', color: colors.primary, marginBottom: spacing.sm },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxl },
  signBox: { width: '45%', borderTopWidth: 1, borderTopColor: colors.text, borderTopStyle: 'solid', paddingTop: spacing.sm },
  signLabel: { fontSize: typography.small, color: colors.textMuted },
  signValue: { fontSize: typography.small, fontWeight: 'bold', color: colors.text, marginTop: spacing.xs },
  footer: { position: 'absolute', bottom: spacing.lg, left: spacing.xxl, right: spacing.xxl, fontSize: typography.micro, color: colors.textSubtle, textAlign: 'center' },
});

interface PermitProps {
  data: CrossBorderPermitPdfData;
  lang: Lang;
}

function PermitPage({ data, lang }: PermitProps) {
  const font = fontFor(lang);
  const dir = dirFor(lang);
  const vehicleLine = [data.vehicle.year, data.vehicle.make, data.vehicle.model, data.vehicle.color]
    .filter(Boolean).join(' ');

  return (
    <Page size="A4" style={[s.page, { fontFamily: font }]}>
      <View style={s.header}>
        <View>
          <Text style={s.brandName}>{data.vendor.name}</Text>
          {data.vendor.tagline && <Text style={s.brandContact}>{data.vendor.tagline}</Text>}
          {data.vendor.address && <Text style={s.brandContact}>{data.vendor.address}</Text>}
          {data.vendor.phone && <Text style={s.brandContact}>{t('phone', lang)}: {data.vendor.phone}</Text>}
          {data.vendor.trn && <Text style={s.brandContact}>{t('trn', lang)}: {data.vendor.trn}</Text>}
        </View>
        <View style={s.docMeta}>
          <Text style={s.docTitle}>{t('crossBorderPermit', lang)}</Text>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{t('permitNo', lang)}</Text>
            <Text style={s.docMetaValue}>{data.permitNo}</Text>
          </View>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{t('permitIssueDate', lang)}</Text>
            <Text style={s.docMetaValue}>{formatDate(data.issueDate, lang)}</Text>
          </View>
          {data.rentalAgreementRef && (
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>{t('rentalAgreementRef', lang)}</Text>
              <Text style={s.docMetaValue}>{data.rentalAgreementRef}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={s.destinationBanner}>
        <Text style={[s.destinationLabel, { writingDirection: dir }]}>{t('destinationCountry', lang)}</Text>
        <Text style={[s.destinationValue, { writingDirection: dir }]}>{data.destinationCountry}</Text>
      </View>

      <View style={s.validityBlock}>
        <View style={s.validityCell}>
          <Text style={s.validityLabel}>{t('permitValidFrom', lang)}</Text>
          <Text style={s.validityValue}>{formatDate(data.validFrom, lang)}</Text>
        </View>
        <View style={s.validityCell}>
          <Text style={s.validityLabel}>{t('permitValidUntil', lang)}</Text>
          <Text style={s.validityValue}>{formatDate(data.validUntil, lang)}</Text>
        </View>
      </View>

      <Text style={[s.declaration, { writingDirection: dir }]}>{t('permitDeclaration', lang)}</Text>

      <Text style={s.sectionTitle}>{t('renter', lang)}</Text>
      <View style={s.panel}>
        <View style={s.row}>
          <Text style={s.label}>{lang === 'ar' ? 'الاسم' : 'Name'}</Text>
          <Text style={s.value}>{data.renter.name}</Text>
        </View>
        {data.renter.nationality && <View style={s.row}><Text style={s.label}>{lang === 'ar' ? 'الجنسية' : 'Nationality'}</Text><Text style={s.value}>{data.renter.nationality}</Text></View>}
        {data.renter.drivingLicenseNo && <View style={s.row}><Text style={s.label}>{lang === 'ar' ? 'رخصة القيادة' : 'Driving Licence'}</Text><Text style={s.value}>{data.renter.drivingLicenseNo}</Text></View>}
        {data.renter.passportNo && <View style={s.row}><Text style={s.label}>{lang === 'ar' ? 'رقم الجواز' : 'Passport No.'}</Text><Text style={s.value}>{data.renter.passportNo}</Text></View>}
        {data.renter.emiratesId && <View style={s.row}><Text style={s.label}>{t('emiratesId', lang)}</Text><Text style={s.value}>{data.renter.emiratesId}</Text></View>}
        {data.renter.phone && <View style={s.row}><Text style={s.label}>{t('phone', lang)}</Text><Text style={s.value}>{data.renter.phone}</Text></View>}
      </View>

      <Text style={s.sectionTitle}>{t('vehicle', lang)}</Text>
      <View style={s.panel}>
        {vehicleLine && <View style={s.row}><Text style={s.label}>{t('vehicle', lang)}</Text><Text style={s.value}>{vehicleLine}</Text></View>}
        {data.vehicle.licensePlate && <View style={s.row}><Text style={s.label}>{t('licensePlate', lang)}</Text><Text style={s.value}>{data.vehicle.licensePlate}</Text></View>}
        {data.vehicle.vin && <View style={s.row}><Text style={s.label}>{t('vin', lang)}</Text><Text style={s.value}>{data.vehicle.vin}</Text></View>}
      </View>

      {(data.borderCrossing || data.routeOfTravel || data.purposeOfTravel) && (
        <>
          <Text style={s.sectionTitle}>{t('routeOfTravel', lang)}</Text>
          <View style={s.panel}>
            {data.borderCrossing && <View style={s.row}><Text style={s.label}>{t('borderCrossing', lang)}</Text><Text style={s.value}>{data.borderCrossing}</Text></View>}
            {data.routeOfTravel && <View style={s.row}><Text style={s.label}>{t('routeOfTravel', lang)}</Text><Text style={s.value}>{data.routeOfTravel}</Text></View>}
            {data.purposeOfTravel && <View style={s.row}><Text style={s.label}>{t('purposeOfTravel', lang)}</Text><Text style={s.value}>{data.purposeOfTravel}</Text></View>}
          </View>
        </>
      )}

      <View style={s.conditions}>
        <Text style={s.conditionsTitle}>{t('termsConditions', lang)}</Text>
        <Text style={{ writingDirection: dir }}>{t('permitConditions', lang)}</Text>
      </View>

      <View style={s.signRow}>
        <View style={s.signBox}>
          <Text style={s.signLabel}>{t('authorisedBy', lang)} ({t('rentalCompany', lang)})</Text>
          <Text style={s.signValue}>{data.vendor.name}</Text>
        </View>
        <View style={s.signBox}>
          <Text style={s.signLabel}>{t('signature', lang)} ({t('renter', lang)})</Text>
          <Text style={s.signValue}>{data.renter.name}</Text>
        </View>
      </View>

      <Text style={s.footer} fixed>
        {t('generatedBy', lang)} · {data.permitNo}
      </Text>
    </Page>
  );
}

export function CrossBorderPermitPdf({ data, lang = 'en' }: { data: CrossBorderPermitPdfData; lang?: Lang }) {
  return (
    <Document
      title={`${t('crossBorderPermit', lang)} ${data.permitNo}`}
      author={data.vendor.name}
      subject={`${t('crossBorderPermit', lang)} - ${data.destinationCountry}`}
    >
      <PermitPage data={data} lang={lang} />
    </Document>
  );
}
