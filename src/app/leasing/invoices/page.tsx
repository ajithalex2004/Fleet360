'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Edit2, Send, Check, Trash2 } from 'lucide-react';

interface InvoiceLine {
  id?: string;
  description: string;
  lineType: 'RENT' | 'FUEL' | 'FINE' | 'OVERAGE' | 'MAINTENANCE' | 'INSURANCE' | 'DEPOSIT' | 'OTHER';
  contractId: string;
  vehicleRef: string;
  quantity: number;
  unitAmount: number;
  totalAmount?: number;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  lessee: { name: string; id: string };
  billingPeriod: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  subtotal: number;
  vatPct: number;
  vat: number;
  total: number;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}

interface Lessee {
  id: string;
  name: string;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'DRAFT':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    case 'SENT':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'PAID':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'OVERDUE':
      return 'bg-red-900/30 text-red-200 border-red-700';
    case 'CANCELLED':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showNewModal, setShowNewModal] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    lesseeId: '',
    billingPeriod: '',
    issueDate: '',
    dueDate: '',
    vatPct: 5,
    lines: [{ description: '', lineType: 'RENT' as const, contractId: '', vehicleRef: '', quantity: 1, unitAmount: 0 }],
  });

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/invoices');
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const data = await response.json();
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching invoices');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLessees = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/lessees');
      if (!response.ok) throw new Error('Failed to fetch lessees');
      const data = await response.json();
      setLessees(data);
    } catch (err) {
      console.error('Error fetching lessees:', err);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
    fetchLessees();
  }, [fetchInvoices, fetchLessees]);

  const handleAddLine = () => {
    setFormData({
      ...formData,
      lines: [...formData.lines, { description: '', lineType: 'RENT', contractId: '', vehicleRef: '', quantity: 1, unitAmount: 0 }],
    });
  };

  const handleRemoveLine = (index: number) => {
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index),
    });
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines];
    (newLines[index] as any)[field] = value;
    setFormData({ ...formData, lines: newLines });
  };

  const calculateLineTotal = (line: InvoiceLine): number => {
    return line.quantity * line.unitAmount;
  };

  const subtotal = formData.lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
  const vat = subtotal * (formData.vatPct / 100);
  const total = subtotal + vat;

  const handleCreateInvoice = async () => {
    try {
      const response = await fetch('/api/leasing/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesseeId: formData.lesseeId,
          billingPeriod: formData.billingPeriod,
          issueDate: formData.issueDate,
          dueDate: formData.dueDate,
          vatPct: formData.vatPct,
          lines: formData.lines.map(line => ({
            ...line,
            quantity: parseInt(line.quantity.toString()),
            unitAmount: parseFloat(line.unitAmount.toString()),
          })),
        }),
      });
      if (!response.ok) throw new Error('Failed to create invoice');
      setFormData({
        lesseeId: '',
        billingPeriod: '',
        issueDate: '',
        dueDate: '',
        vatPct: 5,
        lines: [{ description: '', lineType: 'RENT', contractId: '', vehicleRef: '', quantity: 1, unitAmount: 0 }],
      });
      setShowNewModal(false);
      fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating invoice');
    }
  };

  const handleSendInvoice = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/leasing/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SENT' }),
      });
      if (!response.ok) throw new Error('Failed to send invoice');
      fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending invoice');
    }
  };

  const handleMarkPaid = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/leasing/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAID' }),
      });
      if (!response.ok) throw new Error('Failed to mark invoice as paid');
      fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error marking invoice as paid');
    }
  };

  const filteredInvoices = statusFilter === 'All'
    ? invoices
    : invoices.filter(i => i.status === statusFilter);

  const toggleRowExpand = (invoiceId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Invoice Management</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
          >
            <Plus size={20} /> New Invoice
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        <div className="mb-6 flex gap-2">
          {['All', 'DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg transition ${
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">Loading invoices...</div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-4 py-3 text-left w-8"></th>
                  <th className="px-4 py-3 text-left">Invoice No</th>
                  <th className="px-4 py-3 text-left">Lessee</th>
                  <th className="px-4 py-3 text-left">Billing Period</th>
                  <th className="px-4 py-3 text-left">Issue Date</th>
                  <th className="px-4 py-3 text-left">Due Date</th>
                  <th className="px-4 py-3 text-center">Lines</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                  <th className="px-4 py-3 text-right">VAT</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(invoice => (
                  <React.Fragment key={invoice.id}>
                    <tr className="border-b border-slate-700 hover:bg-slate-750">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleRowExpand(invoice.id)}
                          className="text-slate-200 hover:text-slate-200"
                        >
                          {expandedRows.has(invoice.id) ? 'v' : '>'}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium">{invoice.invoiceNo}</td>
                      <td className="px-4 py-3">{invoice.lessee.name}</td>
                      <td className="px-4 py-3 text-sm">{invoice.billingPeriod}</td>
                      <td className="px-4 py-3 text-sm">{invoice.issueDate}</td>
                      <td className="px-4 py-3 text-sm">{invoice.dueDate}</td>
                      <td className="px-4 py-3 text-center text-sm">{invoice.lines.length}</td>
                      <td className="px-4 py-3 text-right">{invoice.subtotal.toFixed(2)} AED</td>
                      <td className="px-4 py-3 text-right">{invoice.vat.toFixed(2)} AED</td>
                      <td className="px-4 py-3 text-right font-semibold">{invoice.total.toFixed(2)} AED</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded border ${getStatusBadgeColor(invoice.status)}`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {invoice.status === 'DRAFT' && (
                            <button
                              onClick={() => handleSendInvoice(invoice.id)}
                              className="text-blue-400 hover:text-blue-300 transition"
                              title="Send invoice"
                            >
                              <Send size={16} />
                            </button>
                          )}
                          {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleMarkPaid(invoice.id)}
                              className="text-emerald-400 hover:text-emerald-300 transition"
                              title="Mark as paid"
                            >
                              <Check size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedRows.has(invoice.id) && (
                      <tr className="border-b border-slate-700 bg-slate-750/50">
                        <td colSpan={12} className="px-4 py-4">
                          <div className="ml-4">
                            <h4 className="font-semibold text-sm mb-3">Invoice Line Items</h4>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-600">
                                    <th className="px-2 py-2 text-left">Description</th>
                                    <th className="px-2 py-2 text-left">Type</th>
                                    <th className="px-2 py-2 text-left">Contract</th>
                                    <th className="px-2 py-2 text-left">Vehicle</th>
                                    <th className="px-2 py-2 text-right">Qty</th>
                                    <th className="px-2 py-2 text-right">Unit Amount</th>
                                    <th className="px-2 py-2 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {invoice.lines.map((line, idx) => (
                                    <tr key={idx} className="border-b border-slate-700">
                                      <td className="px-2 py-2">{line.description}</td>
                                      <td className="px-2 py-2">{line.lineType}</td>
                                      <td className="px-2 py-2">{line.contractId}</td>
                                      <td className="px-2 py-2">{line.vehicleRef}</td>
                                      <td className="px-2 py-2 text-right">{line.quantity}</td>
                                      <td className="px-2 py-2 text-right">{line.unitAmount.toFixed(2)}</td>
                                      <td className="px-2 py-2 text-right font-medium">{(line.quantity * line.unitAmount).toFixed(2)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* New Invoice Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">New Invoice</h2>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Lessee</label>
                    <select
                      value={formData.lesseeId}
                      onChange={e => setFormData({...formData, lesseeId: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                    >
                      <option value="">Select lessee</option>
                      {lessees.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Billing Period (YYYY-MM)</label>
                    <input
                      type="text"
                      placeholder="2024-04"
                      value={formData.billingPeriod}
                      onChange={e => setFormData({...formData, billingPeriod: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Issue Date</label>
                    <input
                      type="date"
                      value={formData.issueDate}
                      onChange={e => setFormData({...formData, issueDate: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Due Date</label>
                    <input
                      type="date"
                      value={formData.dueDate}
                      onChange={e => setFormData({...formData, dueDate: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">VAT %</label>
                    <input
                      type="number"
                      value={formData.vatPct}
                      onChange={e => setFormData({...formData, vatPct: parseFloat(e.target.value)})}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                    />
                  </div>
                </div>

                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Line Items</h3>
                    <button
                      onClick={handleAddLine}
                      className="text-blue-400 hover:text-blue-300 text-sm transition"
                    >
                      + Add Line
                    </button>
                  </div>
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {formData.lines.map((line, idx) => (
                      <div key={idx} className="bg-slate-900 p-3 rounded border border-slate-600">
                        <div className="grid grid-cols-6 gap-2 mb-2">
                          <input
                            type="text"
                            placeholder="Description"
                            value={line.description}
                            onChange={e => handleLineChange(idx, 'description', e.target.value)}
                            className="col-span-2 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          />
                          <select
                            value={line.lineType}
                            onChange={e => handleLineChange(idx, 'lineType', e.target.value)}
                            className="col-span-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          >
                            <option>RENT</option>
                            <option>FUEL</option>
                            <option>FINE</option>
                            <option>OVERAGE</option>
                            <option>MAINTENANCE</option>
                            <option>INSURANCE</option>
                            <option>DEPOSIT</option>
                            <option>OTHER</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Contract"
                            value={line.contractId}
                            onChange={e => handleLineChange(idx, 'contractId', e.target.value)}
                            className="col-span-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          />
                          <input
                            type="text"
                            placeholder="Vehicle"
                            value={line.vehicleRef}
                            onChange={e => handleLineChange(idx, 'vehicleRef', e.target.value)}
                            className="col-span-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-6 gap-2">
                          <input
                            type="number"
                            placeholder="Qty"
                            value={line.quantity}
                            onChange={e => handleLineChange(idx, 'quantity', parseInt(e.target.value) || 0)}
                            className="col-span-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          />
                          <input
                            type="number"
                            placeholder="Unit Amount"
                            value={line.unitAmount}
                            onChange={e => handleLineChange(idx, 'unitAmount', parseFloat(e.target.value) || 0)}
                            className="col-span-2 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs"
                          />
                          <div className="col-span-2 bg-slate-800 rounded px-2 py-1 text-slate-300 text-xs flex items-center">
                            Total: {calculateLineTotal(line).toFixed(2)} AED
                          </div>
                          <button
                            onClick={() => handleRemoveLine(idx)}
                            className="col-span-1 text-red-400 hover:text-red-300 transition"
                            title="Remove line"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="mt-6 pt-4 border-t border-slate-700 space-y-2">
                  <div className="flex justify-end gap-8">
                    <div>
                      <p className="text-slate-400 text-sm">Subtotal:</p>
                      <p className="font-semibold">{subtotal.toFixed(2)} AED</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">VAT ({formData.vatPct}%):</p>
                      <p className="font-semibold">{vat.toFixed(2)} AED</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Total:</p>
                      <p className="text-lg font-bold text-blue-400">{total.toFixed(2)} AED</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateInvoice}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Create Invoice
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
