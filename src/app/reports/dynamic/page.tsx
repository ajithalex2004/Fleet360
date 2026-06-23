'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Columns3,
  Download,
  FileSpreadsheet,
  FileText,
  GripVertical,
  LayoutTemplate,
  PieChart,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { downloadCSV, downloadXLSX } from '@/lib/exportUtils';
import { downloadTablePdf } from '@/lib/exportTablePdf';
import { PageHeader } from '@/components/ui/page-theme';

type FieldType = 'text' | 'number' | 'money' | 'date' | 'status' | 'boolean';
type Operator = 'contains' | 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'isEmpty' | 'isNotEmpty';

interface Field {
  key: string;
  label: string;
  type: FieldType;
  groupable?: boolean;
  aggregatable?: boolean;
}

interface Dataset {
  key: string;
  label: string;
  module: string;
  description: string;
  defaultColumns: string[];
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
  fields: Field[];
}

interface Filter {
  field: string;
  operator: Operator;
  value?: string;
  valueTo?: string;
}

interface Definition {
  datasetKey: string;
  columns: string[];
  filters: Filter[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  groupBy: string[];
  metric: { field: string; aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max' };
  chart: { type: 'bar' | 'line' | 'pie' | 'area'; labelField?: string; valueField?: string };
  limit: number;
}

interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  datasetKey: string;
  definition: Definition;
  updatedAt: string;
}

interface RunResult {
  dataset: Dataset;
  columns: Field[];
  rows: Record<string, unknown>[];
  chart: {
    type: string;
    labelField: string;
    valueField: string;
    points: Array<{ label: string; value: number }>;
  } | null;
}

const OPERATORS: Array<{ value: Operator; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'At least' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'At most' },
  { value: 'between', label: 'Between' },
  { value: 'isEmpty', label: 'Is empty' },
  { value: 'isNotEmpty', label: 'Has value' },
];

export default function DynamicReportsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportName, setReportName] = useState('New Dynamic Report');
  const [reportDescription, setReportDescription] = useState('');
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const dataset = useMemo(() => datasets.find((item) => item.key === definition?.datasetKey) ?? datasets[0], [datasets, definition?.datasetKey]);
  const fields = useMemo(() => dataset?.fields ?? [], [dataset]);
  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const selectedFields = useMemo(
    () => (definition?.columns ?? []).map((key) => fieldMap.get(key)).filter(Boolean) as Field[],
    [definition?.columns, fieldMap],
  );
  const numericFields = useMemo(() => fields.filter((field) => field.aggregatable || field.type === 'number' || field.type === 'money'), [fields]);
  const groupFields = useMemo(() => fields.filter((field) => field.groupable || ['text', 'status', 'date'].includes(field.type)), [fields]);

  const makeDefaultDefinition = useCallback((targetDataset: Dataset): Definition => ({
    datasetKey: targetDataset.key,
    columns: targetDataset.defaultColumns,
    filters: [],
    sort: targetDataset.defaultSort,
    groupBy: [],
    metric: { field: 'id', aggregate: 'count' },
    chart: { type: 'bar' },
    limit: 200,
  }), []);

  const loadDynamicReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/dynamic');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not load Dynamic Reports');
      const nextDatasets = data.datasets ?? [];
      setDatasets(nextDatasets);
      setSavedReports(data.reports ?? []);
      if (nextDatasets[0]) setDefinition(makeDefaultDefinition(nextDatasets[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Dynamic Reports');
    } finally {
      setLoading(false);
    }
  }, [makeDefaultDefinition]);

  useEffect(() => {
    loadDynamicReports();
  }, [loadDynamicReports]);

  const updateDefinition = (updater: (current: Definition) => Definition) => {
    setDefinition((current) => current ? updater(current) : current);
  };

  const setDataset = (datasetKey: string) => {
    const target = datasets.find((item) => item.key === datasetKey);
    if (!target) return;
    setActiveReportId(null);
    setReportName(`${target.label} Report`);
    setReportDescription('');
    setResult(null);
    setDefinition(makeDefaultDefinition(target));
  };

  const addColumn = (fieldKey: string) => {
    if (!fieldMap.has(fieldKey)) return;
    updateDefinition((current) => ({
      ...current,
      columns: current.columns.includes(fieldKey) ? current.columns : [...current.columns, fieldKey],
    }));
  };

  const removeColumn = (fieldKey: string) => {
    updateDefinition((current) => ({
      ...current,
      columns: current.columns.filter((key) => key !== fieldKey),
    }));
  };

  const addFilter = () => {
    const field = fields[0];
    if (!field) return;
    updateDefinition((current) => ({
      ...current,
      filters: [...current.filters, { field: field.key, operator: field.type === 'text' ? 'contains' : 'equals', value: '' }],
    }));
  };

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    updateDefinition((current) => ({
      ...current,
      filters: current.filters.map((filter, i) => i === index ? { ...filter, ...patch } : filter),
    }));
  };

  const removeFilter = (index: number) => {
    updateDefinition((current) => ({
      ...current,
      filters: current.filters.filter((_, i) => i !== index),
    }));
  };

  const runPreview = useCallback(async () => {
    if (!definition) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/dynamic/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition, reportId: activeReportId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Report preview failed');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report preview failed');
    } finally {
      setRunning(false);
    }
  }, [activeReportId, definition]);

  const saveReport = async () => {
    if (!definition) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/dynamic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeReportId,
          name: reportName,
          description: reportDescription,
          definition,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not save report');
      const saved = data.report as SavedReport;
      setActiveReportId(saved.id);
      setSavedReports((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save report');
    } finally {
      setSaving(false);
    }
  };

  const loadSavedReport = (report: SavedReport) => {
    setActiveReportId(report.id);
    setReportName(report.name);
    setReportDescription(report.description ?? '');
    setDefinition(report.definition);
    setResult(null);
  };

  const exportColumns = result?.columns.map((column) => column.key) ?? [];
  const exportRows = result?.rows ?? [];

  const exportWord = () => {
    if (!result?.rows.length) return;
    const headers = result.columns.map((column) => column.label);
    const html = `
      <html><head><meta charset="utf-8"><title>${escapeHtml(reportName)}</title></head>
      <body>
        <h1>${escapeHtml(reportName)}</h1>
        <table border="1" cellspacing="0" cellpadding="6">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>
            ${result.rows.map((row) => `<tr>${result.columns.map((column) => `<td>${escapeHtml(formatValue(row[column.key], column.type))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </body></html>
    `;
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFilename(reportName)}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (loading || !definition || !dataset) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-sm font-semibold text-slate-300">Loading Dynamic Reports...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dynamic Reports"
        subtitle="Drag-and-drop SaaS report writer for tenant-safe operational analytics."
        icon={LayoutTemplate}
        accent="violet"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runPreview} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
              <Play className="h-4 w-4" /> {running ? 'Running...' : 'Run Preview'}
            </button>
            <button onClick={saveReport} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
              <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      />

      {error && (
        <div className="rounded-2xl border border-rose-400 bg-rose-50 px-4 py-3 text-sm font-semibold text-slate-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Columns3 className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-950">Datasets</h2>
            </div>
            <div className="space-y-2">
              {datasets.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setDataset(item.key)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                    item.key === dataset.key
                      ? 'border-indigo-400 bg-indigo-50 text-slate-950 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{item.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{item.module}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-500">{item.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="h-5 w-5 text-violet-600" />
                <h2 className="text-base font-bold text-slate-950">Field Palette</h2>
              </div>
              <span className="text-xs font-semibold text-slate-500">Drag fields</span>
            </div>
            <div className="max-h-[410px] space-y-2 overflow-y-auto pr-1">
              {fields.map((field) => (
                <div
                  key={field.key}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', field.key)}
                  className="group flex cursor-grab items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-all hover:border-indigo-300 hover:bg-indigo-50 active:cursor-grabbing"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">{field.label}</div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{field.type}</div>
                  </div>
                  <button
                    onClick={() => addColumn(field.key)}
                    className="rounded-full bg-white p-1.5 text-indigo-700 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-600 hover:text-white"
                    aria-label={`Add ${field.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-bold text-slate-950">Saved Reports</h2>
            </div>
            <div className="space-y-2">
              {savedReports.length === 0 && <p className="text-sm font-medium text-slate-500">No saved Dynamic Reports yet.</p>}
              {savedReports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => loadSavedReport(report)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${
                    activeReportId === report.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-bold text-slate-950">{report.name}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{report.datasetKey}</div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
              <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Report Name</label>
                <input
                  value={reportName}
                  onChange={(event) => setReportName(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-bold text-slate-950 outline-none transition focus:border-indigo-400 focus:bg-white"
                />
                <input
                  value={reportDescription}
                  onChange={(event) => setReportDescription(event.target.value)}
                  placeholder="Optional report description"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-400"
                />
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-700">Active Dataset</div>
                <div className="mt-2 text-lg font-black text-slate-950">{dataset.label}</div>
                <p className="mt-1 text-xs font-medium text-slate-600">{dataset.description}</p>
              </div>
            </div>
          </section>

          <section
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addColumn(event.dataTransfer.getData('text/plain'));
            }}
            className="rounded-3xl border-2 border-dashed border-indigo-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-950">Report Canvas</h2>
                <p className="text-sm font-medium text-slate-500">Drop fields here to build the report columns.</p>
              </div>
              <button
                onClick={() => setShowFilters((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100"
              >
                <SlidersHorizontal className="h-4 w-4" /> {showFilters ? 'Hide Controls' : 'Show Controls'}
              </button>
            </div>

            <div className="flex min-h-[82px] flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {selectedFields.length === 0 && (
                <div className="flex w-full items-center justify-center text-sm font-semibold text-slate-500">
                  Drag fields from the palette to start building.
                </div>
              )}
              {selectedFields.map((field) => (
                <div key={field.key} className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-slate-950">
                  <GripVertical className="h-4 w-4 text-indigo-500" />
                  {field.label}
                  <button onClick={() => removeColumn(field.key)} className="rounded-full p-1 text-slate-500 hover:bg-white hover:text-rose-600" aria-label={`Remove ${field.label}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {showFilters && (
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-950">Filters</h2>
                  <button onClick={addFilter} className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">
                    <Plus className="h-4 w-4" /> Add Filter
                  </button>
                </div>
                <div className="space-y-3">
                  {definition.filters.length === 0 && <p className="text-sm font-medium text-slate-500">No filters. The preview will use all rows for this tenant.</p>}
                  {definition.filters.map((filter, index) => {
                    const selected = fieldMap.get(filter.field);
                    return (
                      <div key={`${filter.field}-${index}`} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_160px_1fr_1fr_40px]">
                        <select value={filter.field} onChange={(event) => updateFilter(index, { field: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900">
                          {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                        </select>
                        <select value={filter.operator} onChange={(event) => updateFilter(index, { operator: event.target.value as Operator })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900">
                          {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                        </select>
                        <input
                          type={selected?.type === 'date' ? 'date' : selected?.type === 'number' || selected?.type === 'money' ? 'number' : 'text'}
                          value={filter.value ?? ''}
                          disabled={filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty'}
                          onChange={(event) => updateFilter(index, { value: event.target.value })}
                          placeholder="Value"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-100"
                        />
                        <input
                          type={selected?.type === 'date' ? 'date' : selected?.type === 'number' || selected?.type === 'money' ? 'number' : 'text'}
                          value={filter.valueTo ?? ''}
                          disabled={filter.operator !== 'between'}
                          onChange={(event) => updateFilter(index, { valueTo: event.target.value })}
                          placeholder="To"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-100"
                        />
                        <button onClick={() => removeFilter(index)} className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 hover:bg-rose-100" aria-label="Remove filter">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-base font-bold text-slate-950">Grouping, Sorting and Chart</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <ControlSelect
                    label="Group By"
                    value={definition.groupBy[0] ?? ''}
                    onChange={(value) => updateDefinition((current) => ({ ...current, groupBy: value ? [value] : [] }))}
                    options={[{ value: '', label: 'No grouping' }, ...groupFields.map((field) => ({ value: field.key, label: field.label }))]}
                  />
                  <ControlSelect
                    label="Metric"
                    value={definition.metric.field}
                    onChange={(value) => updateDefinition((current) => ({ ...current, metric: { ...current.metric, field: value || 'id' } }))}
                    options={[{ value: 'id', label: 'Count records' }, ...numericFields.map((field) => ({ value: field.key, label: field.label }))]}
                  />
                  <ControlSelect
                    label="Aggregate"
                    value={definition.metric.aggregate}
                    onChange={(value) => updateDefinition((current) => ({ ...current, metric: { ...current.metric, aggregate: value as Definition['metric']['aggregate'] } }))}
                    options={[
                      { value: 'count', label: 'Count' },
                      { value: 'sum', label: 'Sum' },
                      { value: 'avg', label: 'Average' },
                      { value: 'min', label: 'Minimum' },
                      { value: 'max', label: 'Maximum' },
                    ]}
                  />
                  <ControlSelect
                    label="Sort Field"
                    value={definition.sort?.field ?? ''}
                    onChange={(value) => updateDefinition((current) => ({ ...current, sort: value ? { field: value, direction: current.sort?.direction ?? 'desc' } : undefined }))}
                    options={[{ value: '', label: 'No sort' }, ...fields.map((field) => ({ value: field.key, label: field.label }))]}
                  />
                  <ControlSelect
                    label="Sort Direction"
                    value={definition.sort?.direction ?? 'desc'}
                    onChange={(value) => updateDefinition((current) => ({ ...current, sort: { field: current.sort?.field ?? fields[0]?.key ?? '', direction: value as 'asc' | 'desc' } }))}
                    options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]}
                  />
                  <ControlSelect
                    label="Chart Type"
                    value={definition.chart.type}
                    onChange={(value) => updateDefinition((current) => ({ ...current, chart: { ...current.chart, type: value as Definition['chart']['type'] } }))}
                    options={[
                      { value: 'bar', label: 'Bar' },
                      { value: 'line', label: 'Line' },
                      { value: 'area', label: 'Area' },
                      { value: 'pie', label: 'Pie-style' },
                    ]}
                  />
                </div>
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Live Preview</h2>
                <p className="text-sm font-medium text-slate-500">{result ? `${result.rows.length} row(s) returned` : 'Run preview to query the tenant-scoped dataset.'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ExportButton label="CSV" icon={<Download className="h-4 w-4" />} disabled={!exportRows.length} onClick={() => downloadCSV(`${safeFilename(reportName)}.csv`, exportRows, exportColumns)} />
                <ExportButton label="Excel" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!exportRows.length} onClick={() => downloadXLSX(`${safeFilename(reportName)}.xlsx`, exportRows, exportColumns)} />
                <ExportButton label="PDF" icon={<FileText className="h-4 w-4" />} disabled={!exportRows.length} onClick={() => downloadTablePdf({
                  filename: `${safeFilename(reportName)}.pdf`,
                  title: reportName,
                  columns: result?.columns.map((column) => column.key) ?? [],
                  rows: (result?.rows ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, formatValue(value, fieldMap.get(key)?.type)]))) as Array<Record<string, string | number>>,
                })} />
                <ExportButton label="Word" icon={<FileText className="h-4 w-4" />} disabled={!exportRows.length} onClick={exportWord} />
              </div>
            </div>

            {result?.chart && result.chart.points.length > 0 && (
              <div className="border-b border-slate-200 p-5">
                <div className="mb-4 flex items-center gap-2">
                  {definition.chart.type === 'pie' ? <PieChart className="h-5 w-5 text-violet-700" /> : <BarChart3 className="h-5 w-5 text-violet-700" />}
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Chart Preview</h3>
                </div>
                <ChartPreview points={result.chart.points} type={definition.chart.type} />
              </div>
            )}

            <div className="overflow-auto">
              {!result && (
                <div className="flex min-h-[240px] items-center justify-center text-center">
                  <div>
                    <LayoutTemplate className="mx-auto h-12 w-12 text-slate-300" />
                    <p className="mt-3 text-base font-bold text-slate-700">Build a report, then run preview.</p>
                    <p className="mt-1 text-sm font-medium text-slate-500">Reports are always tenant-scoped and RBAC-controlled.</p>
                  </div>
                </div>
              )}
              {result && (
                <table className="min-w-full text-left">
                  <thead className="bg-slate-100">
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column.key} className="border-b border-r border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-slate-100 hover:bg-blue-50/50">
                        {result.columns.map((column) => (
                          <td key={column.key} className="border-r border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
                            {formatValue(row[column.key], column.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {result.rows.length === 0 && (
                      <tr>
                        <td colSpan={result.columns.length} className="px-5 py-12 text-center text-sm font-semibold text-slate-500">No rows match the current filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ControlSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-950 outline-none focus:border-indigo-400 focus:bg-white">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ExportButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function ChartPreview({ points, type }: { points: Array<{ label: string; value: number }>; type: string }) {
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  return (
    <div className={`grid gap-3 ${type === 'pie' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : ''}`}>
      {points.map((point, index) => {
        const pct = Math.max(4, Math.round((Math.abs(point.value) / max) * 100));
        return (
          <div key={`${point.label}-${index}`} className="grid grid-cols-[180px_1fr_110px] items-center gap-3">
            <div className="truncate text-sm font-bold text-slate-700" title={point.label}>{point.label}</div>
            <div className="h-4 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${index % 4 === 0 ? 'bg-indigo-500' : index % 4 === 1 ? 'bg-emerald-500' : index % 4 === 2 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-right text-sm font-black text-slate-950">{formatNumber(point.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(value: unknown, type?: FieldType) {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'money') return `${formatNumber(Number(value))} AED`;
  if (type === 'number') return formatNumber(Number(value));
  if (type === 'date') return String(value).slice(0, 10);
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(value);
}

function safeFilename(value: string) {
  return (value || 'dynamic-report').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'dynamic-report';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
