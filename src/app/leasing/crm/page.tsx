'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Inquiry {
  id: string;
  inquiryNo: string;
  customerName: string;
  company?: string;
  vehicleType: string;
  count: number;
  duration: string;
  leaseType: string;
  quotationsLinked: number;
  status: 'NEW' | 'CONTACTED' | 'QUOTATION_SENT' | 'CONVERTED' | 'LOST';
  assignedTo?: string;
  createdDate: string;
}

interface CRMData {
  inquiries: Inquiry[];
  pipeline: Record<string, number>;
  conversionRate: number;
}

type StatusType = 'NEW' | 'CONTACTED' | 'QUOTATION_SENT' | 'CONVERTED' | 'LOST';
type StatusFilter = 'ALL' | StatusType;

const pipelineStages: StatusType[] = ['NEW', 'CONTACTED', 'QUOTATION_SENT', 'CONVERTED'];

export default function CRMPage() {
  const [data, setData] = useState<CRMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/leasing/crm');
        if (!res.ok) throw new Error('Failed to fetch CRM data');
        const crmData = await res.json();
        setData(crmData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleAdvanceStage = async (inquiryId: string, currentStatus: string) => {
    const nextStageMap: Record<string, string> = {
      NEW: 'CONTACTED',
      CONTACTED: 'QUOTATION_SENT',
      QUOTATION_SENT: 'CONVERTED',
    };

    const nextStatus = nextStageMap[currentStatus];
    if (!nextStatus) return;

    setUpdating(inquiryId);

    try {
      const res = await fetch(`/api/leasing/crm/${inquiryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) throw new Error('Failed to update inquiry');

      const updated = await res.json();
      if (data) {
        setData({
          ...data,
          inquiries: data.inquiries.map((inq) => (inq.id === inquiryId ? updated : inq)),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update inquiry');
    } finally {
      setUpdating(null);
    }
  };

  const filteredInquiries =
    statusFilter === 'ALL' ? data?.inquiries || [] : (data?.inquiries || []).filter((i) => i.status === statusFilter);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: 'bg-blue-900 text-blue-200',
      CONTACTED: 'bg-indigo-900 text-indigo-200',
      QUOTATION_SENT: 'bg-purple-900 text-purple-200',
      CONVERTED: 'bg-emerald-900 text-emerald-200',
      LOST: 'bg-rose-900 text-rose-200',
    };
    return colors[status] || 'bg-[var(--bg-surface-hover)] text-[var(--text-main)]';
  };

  const pipelineTotal = data ? Object.values(data.pipeline).reduce((a, b) => a + b, 0) : 0;
  const conversionColor =
    (data?.conversionRate || 0) > 0.30 ? 'text-emerald-300' : 'text-amber-300';

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-main)]">CRM & Leads</h1>
          <Link
            href="/leasing/inquiries"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-[var(--text-main)] px-4 py-2 rounded-lg transition"
          >
            +
            New Inquiry
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Pipeline Funnel */}
        {!loading && data && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--text-main)] mb-4">Sales Pipeline</h2>
            <div className="grid grid-cols-5 gap-3">
              {pipelineStages.map((stage) => {
                const count = data.pipeline[stage] || 0;
                const percentage = pipelineTotal > 0 ? ((count / pipelineTotal) * 100).toFixed(0) : 0;
                return (
                  <div key={stage} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 text-center">
                    <p className="text-[var(--text-muted)] text-xs font-medium mb-2">{stage.replace('_', ' ')}</p>
                    <p className="text-2xl font-bold text-[var(--text-main)]">{count}</p>
                    <p className="text-xs text-[var(--text-faint)] mt-1">{percentage}%</p>
                  </div>
                );
              })}
            </div>

            {/* Conversion Rate */}
            <div className="mt-6 bg-gradient-to-r from-gray-800 to-gray-700 border border-[var(--border-strong)] rounded-lg p-6">
              <p className="text-[var(--text-muted)] text-sm mb-2">Conversion Rate (to CONVERTED)</p>
              <div className="flex items-baseline gap-3">
                <p className={`text-4xl font-bold ${conversionColor}`}>
                  {((data.conversionRate || 0) * 100).toFixed(1)}%
                </p>
                <p className="text-[var(--text-muted)] text-sm">of total inquiries converted</p>
              </div>
            </div>
          </div>
        )}

        {/* Status Filter */}
        <div className="mb-6 flex gap-2 flex-wrap">
          {(['ALL', 'NEW', 'CONTACTED', 'QUOTATION_SENT', 'CONVERTED', 'LOST'] as StatusFilter[]).map(
            (status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-lg transition ${
                  statusFilter === status
                    ? 'bg-blue-600 text-[var(--text-main)]'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
                }`}
              >
                {status.replace('_', ' ')}
              </button>
            )
          )}
        </div>

        {/* Loading */}
        {loading && <p className="text-[var(--text-muted)] text-center py-8">Loading inquiries...</p>}

        {/* Table */}
        {!loading && filteredInquiries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Inquiry No</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Customer / Company</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Vehicle Type</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Count</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Duration</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Lease Type</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Quotations</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Status</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Assigned To</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Created</th>
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInquiries.map((inquiry) => {
                  const nextStageMap: Record<string, string> = {
                    NEW: 'CONTACTED',
                    CONTACTED: 'QUOTATION_SENT',
                    QUOTATION_SENT: 'CONVERTED',
                  };

                  const nextStage = nextStageMap[inquiry.status];

                  return (
                    <tr key={inquiry.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]">
                      <td className="px-4 py-3 text-[var(--text-main)] font-mono text-xs">{inquiry.inquiryNo}</td>
                      <td className="px-4 py-3 text-[var(--text-main)]">
                        {inquiry.customerName}
                        {inquiry.company && <p className="text-xs text-[var(--text-muted)]">{inquiry.company}</p>}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{inquiry.vehicleType}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{inquiry.count}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{inquiry.duration}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{inquiry.leaseType}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{inquiry.quotationsLinked}</td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(inquiry.status)}`}>
                          {inquiry.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{inquiry.assignedTo || '-'}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                        {new Date(inquiry.createdDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {nextStage && (
                          <button
                            onClick={() => handleAdvanceStage(inquiry.id, inquiry.status)}
                            disabled={updating === inquiry.id}
                            className="p-1 bg-blue-900 hover:bg-blue-800 disabled:bg-[var(--bg-surface-hover)] text-blue-200 rounded transition"
                            title={`Advance to ${nextStage.replace('_', ' ')}`}
                          >
                            &rarr;
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredInquiries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--text-muted)]">No inquiries found in this stage</p>
          </div>
        )}
      </div>
    </div>
  );
}
