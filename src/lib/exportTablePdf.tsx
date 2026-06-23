import React from 'react';
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, color: '#111827' },
  title: { fontSize: 16, marginBottom: 12, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerRow: { flexDirection: 'row', backgroundColor: '#e5eefc', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  cell: { flex: 1, padding: 6 },
  headerCell: { flex: 1, padding: 6, fontWeight: 700 },
});

function TablePdf({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerRow}>
          {columns.map((column) => (
            <Text key={column} style={styles.headerCell}>{column}</Text>
          ))}
        </View>
        {rows.map((row, index) => (
          <View key={`${row[columns[0]] ?? index}-${index}`} style={styles.row}>
            {columns.map((column) => (
              <Text key={column} style={styles.cell}>{String(row[column] ?? '')}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function downloadTablePdf({
  filename,
  title,
  columns,
  rows,
}: {
  filename: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}) {
  if (!rows.length) return;
  const blob = await pdf(<TablePdf title={title} columns={columns} rows={rows} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
