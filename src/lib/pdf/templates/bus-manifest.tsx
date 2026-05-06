/**
 * Bilingual passenger manifest PDF for staff bus trips.
 *
 * Carried in the vehicle during the trip; required for RTA / law-enforcement
 * inspections and as the printed evidence in incident response. Layout is
 * landscape A4 to fit a wide table of passengers + their stops + status.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatDate } from '../theme';
import { t } from '../i18n';

export interface ManifestPassenger {
  employeeName: string | null;
  employeeId: string | null;
  department: string | null;
  boardingStop: string | null;
  alightingStop: string | null;
  status: 'CONFIRMED' | 'BOARDED' | 'ABSENT' | 'NO_SHOW' | string;
  boardedAt: string | Date | null;
  emergencyContact?: string | null;
}

export interface BusManifestPdfData {
  manifestNo: string;
  generatedAt: string | Date;
  vendor: { name: string; tagline?: string; phone?: string };
  trip: {
    tripNumber: string;
    departureAt: string | Date;
    arrivalAt: string | Date | null;
    routeName: string;
    routeOrigin: string;
    routeDestination: string;
    shiftType: string | null;
    capacity: number | null;
  };
  driver: {
    name: string | null;
    contactNumber: string | null;
    licenseNumber: string | null;
  };
  vehicle: {
    licensePlate: string | null;
    make: string | null;
    model: string | null;
  };
  passengers: ManifestPassenger[];
}

const formatTime = (input: Date | string | undefined | null) => {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const s = StyleSheet.create({
  page: {
    paddingTop: spacing.xl, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl,
    fontSize: typography.small, color: colors.text,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingBottom: spacing.md, marginBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.primary, borderBottomStyle: 'solid',
  },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary },
  brandSub: { fontSize: typography.micro, color: colors.textMuted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontSize: typography.h2, fontWeight: 'bold', color: colors.primary, letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', marginTop: 2 },
  docMetaLabel: { fontSize: typography.micro, color: colors.textMuted, minWidth: 70 },
  docMetaValue: { fontSize: typography.micro, color: colors.text, fontWeight: 'bold' },

  panelGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  panel: { flex: 1, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4, padding: spacing.sm },
  panelTitle: { fontSize: typography.micro, color: colors.primary, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' },
  panelRow: { flexDirection: 'row', marginBottom: 2 },
  panelLabel: { fontSize: typography.micro, color: colors.textMuted, width: '40%' },
  panelValue: { fontSize: typography.micro, color: colors.text, width: '60%', fontWeight: 'bold' },

  totalsBar: { flexDirection: 'row', backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4, marginBottom: spacing.md },
  totalCell: { flex: 1, padding: spacing.sm, alignItems: 'center', borderRightWidth: 1, borderRightColor: colors.border, borderRightStyle: 'solid' },
  totalCellLast: { flex: 1, padding: spacing.sm, alignItems: 'center' },
  totalLabel: { fontSize: typography.micro, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue: { fontSize: typography.h3, fontWeight: 'bold', color: colors.text, marginTop: 1 },

  table: { borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'solid', borderRadius: 2 },
  thead: { flexDirection: 'row', backgroundColor: colors.primary, paddingHorizontal: 4, paddingVertical: 4 },
  th: { color: colors.white, fontSize: typography.micro, fontWeight: 'bold' },
  trow: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  trowAlt: { backgroundColor: colors.rowAlt },
  td: { fontSize: typography.micro, color: colors.text },
  c_idx:    { width: '4%' },
  c_name:   { width: '24%' },
  c_id:     { width: '11%' },
  c_dept:   { width: '15%' },
  c_board:  { width: '15%' },
  c_alight: { width: '13%' },
  c_status: { width: '10%' },
  c_time:   { width: '8%' },
  pillBox: { paddingVertical: 1, paddingHorizontal: 4, borderRadius: 2, alignSelf: 'flex-start' },
  pill_CONFIRMED: { backgroundColor: '#dbeafe', color: '#1e40af' },
  pill_BOARDED:   { backgroundColor: '#dcfce7', color: '#166534' },
  pill_ABSENT:    { backgroundColor: '#fef3c7', color: '#92400e' },
  pill_NO_SHOW:   { backgroundColor: '#fee2e2', color: '#991b1b' },

  footer: { position: 'absolute', bottom: spacing.md, left: spacing.xl, right: spacing.xl, fontSize: typography.micro, color: colors.textSubtle, textAlign: 'center' },
  pageNo: { position: 'absolute', bottom: spacing.md, right: spacing.xl, fontSize: typography.micro, color: colors.textSubtle },
});

interface PageProps { data: BusManifestPdfData; lang: Lang; }

function ManifestPage({ data, lang }: PageProps) {
  const font = fontFor(lang);
  const dir = dirFor(lang);

  const totals = data.passengers.reduce(
    (acc, p) => {
      const key = (p.status ?? 'CONFIRMED').toUpperCase();
      acc.total += 1;
      if (key === 'CONFIRMED') acc.confirmed += 1;
      if (key === 'BOARDED')   acc.boarded += 1;
      if (key === 'ABSENT')    acc.absent += 1;
      if (key === 'NO_SHOW')   acc.noShow += 1;
      return acc;
    },
    { total: 0, confirmed: 0, boarded: 0, absent: 0, noShow: 0 },
  );

  const vehicleLabel = [data.vehicle.make, data.vehicle.model, data.vehicle.licensePlate ? `(${data.vehicle.licensePlate})` : null]
    .filter(Boolean).join(' ');

  return (
    <Page size="A4" orientation="landscape" style={[s.page, { fontFamily: font }]}>
      <View style={s.header}>
        <View>
          <Text style={s.brandName}>{data.vendor.name}</Text>
          {data.vendor.tagline && <Text style={s.brandSub}>{data.vendor.tagline}</Text>}
          {data.vendor.phone && <Text style={s.brandSub}>{data.vendor.phone}</Text>}
        </View>
        <View style={s.docMeta}>
          <Text style={s.docTitle}>{t('passengerManifest', lang)}</Text>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{t('manifestNo', lang)}</Text>
            <Text style={s.docMetaValue}>{data.manifestNo}</Text>
          </View>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{t('generatedAt', lang)}</Text>
            <Text style={s.docMetaValue}>{formatDate(data.generatedAt, lang)} {formatTime(data.generatedAt)}</Text>
          </View>
        </View>
      </View>

      <View style={s.panelGrid}>
        <View style={s.panel}>
          <Text style={s.panelTitle}>{t('trip', lang)}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('tripNumber', lang)}</Text><Text style={s.panelValue}>{data.trip.tripNumber}</Text></View>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('routeName', lang)}</Text><Text style={s.panelValue}>{data.trip.routeName}</Text></View>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('routeOrigin', lang)}</Text><Text style={s.panelValue}>{data.trip.routeOrigin}</Text></View>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('routeDestination', lang)}</Text><Text style={s.panelValue}>{data.trip.routeDestination}</Text></View>
          {data.trip.shiftType && <View style={s.panelRow}><Text style={s.panelLabel}>{t('shift', lang)}</Text><Text style={s.panelValue}>{data.trip.shiftType}</Text></View>}
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('departureAt', lang)}</Text><Text style={s.panelValue}>{formatDate(data.trip.departureAt, lang)} {formatTime(data.trip.departureAt)}</Text></View>
          {data.trip.arrivalAt && <View style={s.panelRow}><Text style={s.panelLabel}>{t('arrivalAt', lang)}</Text><Text style={s.panelValue}>{formatTime(data.trip.arrivalAt)}</Text></View>}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>{t('driverName', lang)}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('driverName', lang)}</Text><Text style={s.panelValue}>{data.driver.name ?? '—'}</Text></View>
          {data.driver.contactNumber && <View style={s.panelRow}><Text style={s.panelLabel}>{t('phone', lang)}</Text><Text style={s.panelValue}>{data.driver.contactNumber}</Text></View>}
          {data.driver.licenseNumber && <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'رخصة' : 'Licence'}</Text><Text style={s.panelValue}>{data.driver.licenseNumber}</Text></View>}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>{t('vehicleName', lang)}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{t('vehicle', lang)}</Text><Text style={s.panelValue}>{vehicleLabel || '—'}</Text></View>
          {data.trip.capacity != null && <View style={s.panelRow}><Text style={s.panelLabel}>{t('capacityFigure', lang)}</Text><Text style={s.panelValue}>{data.trip.capacity}</Text></View>}
        </View>
      </View>

      <View style={s.totalsBar}>
        <View style={s.totalCell}><Text style={s.totalLabel}>{t('total', lang)}</Text><Text style={s.totalValue}>{totals.total}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{t('confirmedTotal', lang)}</Text><Text style={s.totalValue}>{totals.confirmed}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{t('boardedTotal', lang)}</Text><Text style={[s.totalValue, { color: '#15803d' }]}>{totals.boarded}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{t('absentTotal', lang)}</Text><Text style={[s.totalValue, { color: '#a16207' }]}>{totals.absent}</Text></View>
        <View style={s.totalCellLast}><Text style={s.totalLabel}>{t('noShowTotal', lang)}</Text><Text style={[s.totalValue, { color: '#991b1b' }]}>{totals.noShow}</Text></View>
      </View>

      <View style={s.table}>
        <View style={s.thead}>
          <Text style={[s.th, s.c_idx]}>#</Text>
          <Text style={[s.th, s.c_name]}>{t('paxName', lang)}</Text>
          <Text style={[s.th, s.c_id]}>{t('paxId', lang)}</Text>
          <Text style={[s.th, s.c_dept]}>{t('paxDept', lang)}</Text>
          <Text style={[s.th, s.c_board]}>{t('paxBoard', lang)}</Text>
          <Text style={[s.th, s.c_alight]}>{t('paxAlight', lang)}</Text>
          <Text style={[s.th, s.c_status]}>{t('paxStatus', lang)}</Text>
          <Text style={[s.th, s.c_time]}>{t('paxBoardedAt', lang)}</Text>
        </View>
        {data.passengers.map((p, i) => {
          const status = (p.status ?? 'CONFIRMED').toUpperCase();
          const pillStyle =
            status === 'BOARDED' ? s.pill_BOARDED
            : status === 'ABSENT' ? s.pill_ABSENT
            : status === 'NO_SHOW' ? s.pill_NO_SHOW
            : s.pill_CONFIRMED;
          return (
            <View key={i} style={[s.trow, i % 2 === 1 ? s.trowAlt : null].filter(Boolean) as object[]}>
              <Text style={[s.td, s.c_idx]}>{i + 1}</Text>
              <Text style={[s.td, s.c_name, { writingDirection: dir }]}>{p.employeeName ?? '—'}</Text>
              <Text style={[s.td, s.c_id]}>{p.employeeId ?? '—'}</Text>
              <Text style={[s.td, s.c_dept]}>{p.department ?? '—'}</Text>
              <Text style={[s.td, s.c_board]}>{p.boardingStop ?? '—'}</Text>
              <Text style={[s.td, s.c_alight]}>{p.alightingStop ?? '—'}</Text>
              <View style={[s.c_status]}>
                <Text style={[s.td, s.pillBox, pillStyle]}>{t(`s_${status}` as 's_BOARDED', lang)}</Text>
              </View>
              <Text style={[s.td, s.c_time]}>{p.boardedAt ? formatTime(p.boardedAt) : '—'}</Text>
            </View>
          );
        })}
        {data.passengers.length === 0 && (
          <View style={s.trow}>
            <Text style={[s.td, { width: '100%', textAlign: 'center', color: colors.textMuted, paddingVertical: spacing.sm }]}>—</Text>
          </View>
        )}
      </View>

      <Text style={s.footer} fixed>{t('manifestFooter', lang)} · {data.manifestNo}</Text>
      <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${t('page', lang)} ${pageNumber}/${totalPages}`} />
    </Page>
  );
}

export function BusManifestPdf({ data, lang = 'en' }: { data: BusManifestPdfData; lang?: Lang }) {
  return (
    <Document
      title={`${t('passengerManifest', lang)} ${data.manifestNo}`}
      author={data.vendor.name}
      subject={`Manifest for trip ${data.trip.tripNumber}`}
    >
      <ManifestPage data={data} lang={lang} />
    </Document>
  );
}
