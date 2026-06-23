/**
 * Bilingual Customer Account Statement PDF.
 * Shows opening balance, all invoices + receipts in the period, closing balance.
 */

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { Lang } from '../theme';
import { colors, spacing, typography, fontFor, dirFor, formatMoney, formatDate } from '../theme';
import { t } from '../i18n';

export type StatementTxnType = 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEPOSIT' | 'DEPOSIT_DEDUCTION' | 'DEPOSIT_REFUND';

export interface StatementTransaction {
  date: string | Date;
  type: StatementTxnType;
  reference: string;            // invoice / receipt number
  description?: string | null;
  debit?: number;               // increases customer balance (invoice issued)
  credit?: number;              // decreases customer balance (payment received)
  runningBalance: number;
}

export interface StatementPdfData {
  periodFrom: string | Date;
  periodTo: string | Date;
  vendor: { name: string; tagline?: string; address?: string; phone?: string; email?: string; trn?: string };
  lessee: {
    name: string; type: 'corporate' | 'individual';
    address?: string | null; email?: string | null;
    tradeLicense?: string | null; emiratesId?: string | null;
  };
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
  currency: string;
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
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: typography.small, fontWeight: 'bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  card: { padding: spacing.lg, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  partyName: { fontSize: typography.large, fontWeight: 'bold', color: colors.text },
  partyMeta: { fontSize: typography.small, color: colors.textMuted, marginTop: spacing.xs },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  balanceCard: { flex: 1, marginHorizontal: spacing.xs, padding: spacing.md, backgroundColor: colors.offwhite, borderWidth: 1, borderColor: colors.border, borderStyle: 'solid', borderRadius: 4 },
  balanceLabel: { fontSize: typography.small, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  balanceValue: { fontSize: typography.h3, fontWeight: 'bold', color: colors.text, marginTop: spacing.xs },
  balanceValueClose: { color: colors.primary },
  table: { borderWidth: 1, borderColor: colors.border, borderStyle: 'solid' },
  tableHead: { flexDirection: 'row', backgroundColor: colors.primary, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  tableHeadCell: { color: colors.white, fontSize: typography.small, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  tableRowAlt: { backgroundColor: colors.rowAlt },
  cellText: { fontSize: typography.small, color: colors.text },
  cellAmount: { fontSize: typography.small, color: colors.text, textAlign: 'right' },
  cellMuted: { fontSize: typography.small, color: colors.textSubtle, textAlign: 'right' },
  empty: { padding: spacing.xl, textAlign: 'center', color: colors.textMuted, fontSize: typography.small },
  footer: { position: 'absolute', bottom: spacing.xl, left: spacing.xxl, right: spacing.xxl, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderTopStyle: 'solid' },
  footerText: { fontSize: typography.micro, color: colors.textSubtle },
});

export function StatementPdf({ data, lang }: { data: StatementPdfData; lang: Lang }) {
  const dir = dirFor(lang); const font = fontFor(lang); const ccy = data.currency;
  const txnLabelKey: Record<StatementTxnType, 'txn_INVOICE' | 'txn_PAYMENT' | 'txn_CREDIT_NOTE' | 'txn_DEPOSIT' | 'txn_DEPOSIT_DEDUCTION' | 'txn_DEPOSIT_REFUND'> = {
    INVOICE: 'txn_INVOICE',
    PAYMENT: 'txn_PAYMENT',
    CREDIT_NOTE: 'txn_CREDIT_NOTE',
    DEPOSIT: 'txn_DEPOSIT',
    DEPOSIT_DEDUCTION: 'txn_DEPOSIT_DEDUCTION',
    DEPOSIT_REFUND: 'txn_DEPOSIT_REFUND',
  };

  return (
    <Document title={`${t('accountStatement', lang)} — ${data.lessee.name}`} author={data.vendor.name} creator="Fleet360 Platform">
      <Page size="A4" style={[s.page, { fontFamily: font, direction: dir }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brand}>
            <Text style={[s.brandName, { fontFamily: font }]}>{data.vendor.name}</Text>
            {data.vendor.address && <Text style={[s.brandContact, { fontFamily: font }]}>{data.vendor.address}</Text>}
            {data.vendor.trn && <Text style={[s.brandContact, { fontFamily: font }]}>{t('trn', lang)}: {data.vendor.trn}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { fontFamily: font }]}>{t('accountStatement', lang).toUpperCase()}</Text>
            <View style={s.docMetaRow}>
              <Text style={[s.docMetaLabel, { fontFamily: font }]}>{t('statementPeriod', lang)}:</Text>
              <Text style={[s.docMetaValue, { fontFamily: font }]}>{formatDate(data.periodFrom, lang)} → {formatDate(data.periodTo, lang)}</Text>
            </View>
          </View>
        </View>

        {/* Lessee */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('billTo', lang)}</Text>
          <View style={s.card}>
            <Text style={[s.partyName, { fontFamily: font }]}>{data.lessee.name}</Text>
            <Text style={[s.partyMeta, { fontFamily: font }]}>{t(data.lessee.type, lang)}{data.lessee.address ? ` · ${data.lessee.address}` : ''}</Text>
            {data.lessee.tradeLicense && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('tradeLicense', lang)}: {data.lessee.tradeLicense}</Text>}
            {data.lessee.emiratesId && <Text style={[s.partyMeta, { fontFamily: font }]}>{t('emiratesId', lang)}: {data.lessee.emiratesId}</Text>}
          </View>
        </View>

        {/* Balances */}
        <View style={s.balanceRow}>
          <View style={s.balanceCard}>
            <Text style={[s.balanceLabel, { fontFamily: font }]}>{t('openingBalance', lang)}</Text>
            <Text style={[s.balanceValue, { fontFamily: font }]}>{formatMoney(data.openingBalance, ccy)}</Text>
          </View>
          <View style={s.balanceCard}>
            <Text style={[s.balanceLabel, { fontFamily: font }]}>{t('closingBalance', lang)}</Text>
            <Text style={[s.balanceValue, s.balanceValueClose, { fontFamily: font }]}>{formatMoney(data.closingBalance, ccy)}</Text>
          </View>
        </View>

        {/* Transactions */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { fontFamily: font }]}>{t('itemisedDetail', lang)}</Text>
          <View style={s.table}>
            <View style={s.tableHead}>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1.5 }]}>{t('date', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1.5 }]}>{t('transactionType', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 2 }]}>{t('reference', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1.2, textAlign: 'right' }]}>{t('debit', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1.2, textAlign: 'right' }]}>{t('credit', lang)}</Text>
              <Text style={[s.tableHeadCell, { fontFamily: font, flex: 1.5, textAlign: 'right' }]}>{t('balance', lang)}</Text>
            </View>
            {data.transactions.length === 0 ? (
              <Text style={[s.empty, { fontFamily: font }]}>{t('noTransactions', lang)}</Text>
            ) : (
              data.transactions.map((tx, i) => (
                <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={[s.cellText, { fontFamily: font, flex: 1.5 }]}>{formatDate(tx.date, lang)}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 1.5 }]}>{t(txnLabelKey[tx.type], lang)}</Text>
                  <Text style={[s.cellText, { fontFamily: font, flex: 2 }]}>{tx.reference}{tx.description ? ` · ${tx.description}` : ''}</Text>
                  <Text style={[s.cellAmount, { fontFamily: font, flex: 1.2 }]}>{tx.debit ? formatMoney(tx.debit, ccy) : '—'}</Text>
                  <Text style={[s.cellAmount, { fontFamily: font, flex: 1.2 }]}>{tx.credit ? formatMoney(tx.credit, ccy) : '—'}</Text>
                  <Text style={[s.cellAmount, { fontFamily: font, flex: 1.5, fontWeight: 'bold' }]}>{formatMoney(tx.runningBalance, ccy)}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={[s.footerText, { fontFamily: font }]}>{t('generatedBy', lang)}</Text>
          <Text style={[s.footerText, { fontFamily: font }]} render={({ pageNumber, totalPages }) => `${t('page', lang)} ${pageNumber} ${t('of', lang)} ${totalPages}`} fixed />
        </View>
      </Page>
    </Document>
  );
}
