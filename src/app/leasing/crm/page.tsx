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
    return colors[status] || 'bg-gray-700 text-gray-200';
  };

  const pipelineTotal = data ? Object.values(data.pipeline).reduce((a, b) => a + b, 0) : 0;
  const conversionColor =
    (data?.conversionRate || 0) > 0.30 ? 'text-emerald-300' : 'text-amber-300';

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">CRM & Leads</h1>
          <Link
            href="/leasing/inquiries"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
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
            <h2 className="text-lg font-semibold text-white mb-4">Sales Pipeline</h2>
            <div className="grid grid-cols-5 gap-3">
              {pipelineStages.map((stage) => {
                const count = data.pipeline[stage] || 0;
                const percentage = pipelineTotal > 0 ? ((count / pipelineTotal) * 100).toFixed(0) : 0;
                return (
                  <div key={stage} className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
                    <p className="text-gray-400 text-xs font-medium mb-2">{stage.replace('_', ' ')}</p>
                    <p className="text-2xl font-bold text-white">{count}</p>
                    <p className="text-xs text-gray-500 mt-1">{percentage}%</p>
                  </div>
                );
              })}
            </div>

            {/* Conversion Rate */}
            <div className="mt-6 bg-gradient-to-r from-gray-800 to-gray-700 border border-gray-600 rounded-lg p-6">
              <p className="text-gray-400 text-sm mb-2">Conversion Rate (to CONVERTED)</p>
              <div className="flex items-baseline gap-3">
                <p className={`text-4xl font-bold ${conversionColor}`}>
                  {((data.conversionRate || 0) * 100).toFixed(1)}%
                </p>
                <p className="text-gray-400 text-sm">of total inquiries converted</p>
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
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {status.replace('_', ' ')}
              </button>
            )
          )}
        </div>

        {/* Loading */}
        {loading && <p className="text-gray-400 text-center py-8">Loading inquiries...</p>}

        {/* Table */}
        {!loading && filteredInquiries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Inquiry No</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Customer / Company</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Vehicle Type</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Count</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Duration</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Lease Type</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Quotations</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Status</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Assigned To</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Created</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Actions</th>
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
                    <tr key={inquiry.id} className="border-b border-gray-700 hover:bg-gray-800">
                      <td className="px-4 py-3 text-white font-mono text-xs">{inquiry.inquiryNo}</td>
                      <td className="px-4 py-3 text-gray-200">
                        {inquiry.customerName}
                        {inquiry.company && <p className="text-xs text-gray-400">{inquiry.company}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{inquiry.vehicleType}</td>
                      <td className="px-4 py-3 text-gray-300">{inquiry.count}</td>
                      <td className="px-4 py-3 text-gray-300">{inquiry.duration}</td>
                      <td className="px-4 py-3 text-gray-300">{inquiry.leaseType}</td>
                      <td className="px-4 py-3 text-gray-300">{inquiry.quotationsLinked}</td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(inquiry.status)}`}>
                          {inquiry.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{inquiry.assignedTo || '-'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(inquiry.createdDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {nextStage && (
                          <button
                            onClick={() => handleAdvanceStage(inquiry.id, inquiry.status)}
                            disabled={updating === inquiry.id}
                            className="p-1 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-600 text-blue-200 rounded transition"
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
            <p className="text-gray-400">No inquiries found in this stage</p>
          </div>
        )}
      </div>
    </div>
  );
}
