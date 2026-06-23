/**
 * Bilingual school-bus passenger manifest PDF.
 * Carried by driver/attendant during the trip; required during RTA / police
 * stops and as the printed evidence in incident response. Shows medical
 * alerts prominently for emergency response.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, formatDate } from '../theme';
import { t } from '../i18n';

export interface SchoolBusManifestStudent {
  studentCode: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  pickupStop: string | null;
  dropoffStop: string | null;
  guardian1Name: string | null;
  guardian1Phone: string | null;
  guardian2Phone: string | null;
  medicalAlert: boolean;
  medicalNotes: string | null;
  attendanceStatus?: string;
  boardedAt?: string | Date | null;
}

export interface SchoolBusManifestPdfData {
  manifestNo: string;
  generatedAt: string | Date;
  vendor: { name: string; tagline?: string; phone?: string };
  trip: {
    tripNumber: string;
    sessionType: string | null;
    scheduledDeparture: string | Date;
    routeName: string;
    schoolName: string | null;
  };
  driver: { name: string | null; contactNumber: string | null };
  vehicle: { licensePlate: string | null; make: string | null; model: string | null };
  students: SchoolBusManifestStudent[];
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
    borderBottomWidth: 2, borderBottomColor: '#f59e0b', borderBottomStyle: 'solid',
  },
  brandName: { fontSize: typography.h2, fontWeight: 'bold', color: '#f59e0b' },
  brandSub: { fontSize: typography.micro, color: colors.textMuted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontSize: typography.h2, fontWeight: 'bold', color: '#f59e0b', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', marginTop: 2 },
  docMetaLabel: { fontSize: typography.micro, color: colors.textMuted, minWidth: 70 },
  docMetaValue: { fontSize: typography.micro, color: colors.text, fontWeight: 'bold' },

  panelGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  panel: { flex: 1, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4, padding: spacing.sm },
  panelTitle: { fontSize: typography.micro, color: '#f59e0b', fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' },
  panelRow: { flexDirection: 'row', marginBottom: 2 },
  panelLabel: { fontSize: typography.micro, color: colors.textMuted, width: '40%' },
  panelValue: { fontSize: typography.micro, color: colors.text, width: '60%', fontWeight: 'bold' },

  totalsBar: { flexDirection: 'row', backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderStyle: 'solid', borderRadius: 4, marginBottom: spacing.md },
  totalCell: { flex: 1, padding: spacing.sm, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#fde68a', borderRightStyle: 'solid' },
  totalCellLast: { flex: 1, padding: spacing.sm, alignItems: 'center' },
  totalLabel: { fontSize: typography.micro, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue: { fontSize: typography.h3, fontWeight: 'bold', color: '#78350f', marginTop: 1 },

  table: { borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'solid', borderRadius: 2 },
  thead: { flexDirection: 'row', backgroundColor: '#f59e0b', paddingHorizontal: 4, paddingVertical: 4 },
  th: { color: colors.white, fontSize: typography.micro, fontWeight: 'bold' },
  trow: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  trowAlt: { backgroundColor: colors.rowAlt },
  trowMedical: { backgroundColor: '#fee2e2' },
  td: { fontSize: typography.micro, color: colors.text },
  c_idx:    { width: '4%' },
  c_code:   { width: '10%' },
  c_name:   { width: '22%' },
  c_grade:  { width: '8%' },
  c_pickup: { width: '17%' },
  c_drop:   { width: '17%' },
  c_guard:  { width: '17%' },
  c_med:    { width: '5%' },
  medicalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#dc2626' },
  medicalAlertBox: {
    backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5', borderStyle: 'solid',
    borderRadius: 4, padding: spacing.sm, marginBottom: spacing.md,
  },
  medicalAlertTitle: { fontSize: typography.small, fontWeight: 'bold', color: '#991b1b', marginBottom: spacing.xs },
  medicalAlertItem: { fontSize: typography.micro, color: '#7f1d1d', marginBottom: 1 },

  footer: { position: 'absolute', bottom: spacing.md, left: spacing.xl, right: spacing.xl, fontSize: typography.micro, color: colors.textSubtle, textAlign: 'center' },
  pageNo: { position: 'absolute', bottom: spacing.md, right: spacing.xl, fontSize: typography.micro, color: colors.textSubtle },
});

interface PageProps { data: SchoolBusManifestPdfData; lang: Lang; }

function ManifestPage({ data, lang }: PageProps) {
  const font = fontFor(lang);

  const totals = {
    total: data.students.length,
    medical: data.students.filter(s => s.medicalAlert).length,
    boarded: data.students.filter(s => s.attendanceStatus === 'PRESENT').length,
    absent: data.students.filter(s => s.attendanceStatus === 'ABSENT').length,
    excused: data.students.filter(s => s.attendanceStatus === 'EXCUSED').length,
  };

  const medicalStudents = data.students.filter(s => s.medicalAlert);
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
          <Text style={s.docTitle}>{lang === 'ar' ? 'قائمة ركاب الحافلة المدرسية' : 'School Bus Manifest'}</Text>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{lang === 'ar' ? 'رقم القائمة' : 'Manifest No.'}</Text>
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
          <Text style={s.panelTitle}>{lang === 'ar' ? 'الرحلة' : 'Trip'}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'رقم' : 'No.'}</Text><Text style={s.panelValue}>{data.trip.tripNumber}</Text></View>
          <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'المسار' : 'Route'}</Text><Text style={s.panelValue}>{data.trip.routeName}</Text></View>
          {data.trip.sessionType && <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'الفترة' : 'Session'}</Text><Text style={s.panelValue}>{data.trip.sessionType}</Text></View>}
          <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'المغادرة' : 'Departure'}</Text><Text style={s.panelValue}>{formatDate(data.trip.scheduledDeparture, lang)} {formatTime(data.trip.scheduledDeparture)}</Text></View>
          {data.trip.schoolName && <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'المدرسة' : 'School'}</Text><Text style={s.panelValue}>{data.trip.schoolName}</Text></View>}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>{lang === 'ar' ? 'السائق' : 'Driver'}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'الاسم' : 'Name'}</Text><Text style={s.panelValue}>{data.driver.name ?? '—'}</Text></View>
          {data.driver.contactNumber && <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'الهاتف' : 'Phone'}</Text><Text style={s.panelValue}>{data.driver.contactNumber}</Text></View>}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>{lang === 'ar' ? 'المركبة' : 'Vehicle'}</Text>
          <View style={s.panelRow}><Text style={s.panelLabel}>{lang === 'ar' ? 'المركبة' : 'Vehicle'}</Text><Text style={s.panelValue}>{vehicleLabel || '—'}</Text></View>
        </View>
      </View>

      <View style={s.totalsBar}>
        <View style={s.totalCell}><Text style={s.totalLabel}>{lang === 'ar' ? 'الإجمالي' : 'Total'}</Text><Text style={s.totalValue}>{totals.total}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{lang === 'ar' ? 'صعد' : 'Boarded'}</Text><Text style={[s.totalValue, { color: '#15803d' }]}>{totals.boarded}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{lang === 'ar' ? 'غائب' : 'Absent'}</Text><Text style={[s.totalValue, { color: '#a16207' }]}>{totals.absent}</Text></View>
        <View style={s.totalCell}><Text style={s.totalLabel}>{lang === 'ar' ? 'بعذر' : 'Excused'}</Text><Text style={[s.totalValue, { color: '#0369a1' }]}>{totals.excused}</Text></View>
        <View style={s.totalCellLast}><Text style={s.totalLabel}>{lang === 'ar' ? 'تنبيه طبي' : 'Medical'}</Text><Text style={[s.totalValue, { color: '#991b1b' }]}>{totals.medical}</Text></View>
      </View>

      {medicalStudents.length > 0 && (
        <View style={s.medicalAlertBox}>
          <Text style={s.medicalAlertTitle}>{lang === 'ar' ? '⚠ تنبيهات طبية' : '⚠ Medical Alerts'}</Text>
          {medicalStudents.map((m, i) => (
            <Text key={i} style={s.medicalAlertItem}>
              • {m.fullName} ({m.studentCode}){m.medicalNotes ? ` — ${m.medicalNotes}` : ''}
            </Text>
          ))}
        </View>
      )}

      <View style={s.table}>
        <View style={s.thead}>
          <Text style={[s.th, s.c_idx]}>#</Text>
          <Text style={[s.th, s.c_code]}>{lang === 'ar' ? 'رمز' : 'Code'}</Text>
          <Text style={[s.th, s.c_name]}>{lang === 'ar' ? 'الاسم' : 'Name'}</Text>
          <Text style={[s.th, s.c_grade]}>{lang === 'ar' ? 'الصف' : 'Grade'}</Text>
          <Text style={[s.th, s.c_pickup]}>{lang === 'ar' ? 'صعود' : 'Pickup'}</Text>
          <Text style={[s.th, s.c_drop]}>{lang === 'ar' ? 'نزول' : 'Drop'}</Text>
          <Text style={[s.th, s.c_guard]}>{lang === 'ar' ? 'ولي الأمر' : 'Guardian'}</Text>
          <Text style={[s.th, s.c_med]}>{lang === 'ar' ? 'طبي' : 'Med'}</Text>
        </View>
        {data.students.map((p, i) => {
          const rowStyles = p.medicalAlert
            ? [s.trow, s.trowMedical]
            : i % 2 === 1
              ? [s.trow, s.trowAlt]
              : s.trow;
          return (
            <View key={i} style={rowStyles}>
              <Text style={[s.td, s.c_idx]}>{i + 1}</Text>
              <Text style={[s.td, s.c_code]}>{p.studentCode}</Text>
              <Text style={[s.td, s.c_name]}>{p.fullName}</Text>
              <Text style={[s.td, s.c_grade]}>{p.grade ?? ''}{p.section ? `-${p.section}` : ''}</Text>
              <Text style={[s.td, s.c_pickup]}>{p.pickupStop ?? '—'}</Text>
              <Text style={[s.td, s.c_drop]}>{p.dropoffStop ?? '—'}</Text>
              <View style={s.c_guard}>
                <Text style={s.td}>{p.guardian1Name ?? '—'}</Text>
                {p.guardian1Phone && <Text style={[s.td, { color: colors.textMuted }]}>{p.guardian1Phone}</Text>}
              </View>
              <View style={s.c_med}>
                {p.medicalAlert && <View style={s.medicalDot} />}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={s.footer} fixed>
        {lang === 'ar'
          ? 'احتفظ بهذه القائمة في المركبة طوال مدة الرحلة. قدمها لسلطات إنفاذ القانون عند الطلب.'
          : 'Carry this manifest in the vehicle for the duration of the trip. Present to law-enforcement on request.'}
        {' · '}{data.manifestNo}
      </Text>
      <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${t('page', lang)} ${pageNumber}/${totalPages}`} />
    </Page>
  );
}

export function SchoolBusManifestPdf({ data, lang = 'en' }: { data: SchoolBusManifestPdfData; lang?: Lang }) {
  return (
    <Document
      title={`${lang === 'ar' ? 'قائمة ركاب الحافلة المدرسية' : 'School Bus Manifest'} ${data.manifestNo}`}
      author={data.vendor.name}
      subject={`Manifest for trip ${data.trip.tripNumber}`}
    >
      <ManifestPage data={data} lang={lang} />
    </Document>
  );
}
