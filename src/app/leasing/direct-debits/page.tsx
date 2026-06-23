'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';

interface DirectDebit {
  id: string;
  mandateRef: string;
  lesseeId: string;
  lessee: { name: string };
  contractId?: string;
  bankName: string;
  accountName: string;
  iban: string;
  collectionDay: number;
  currency: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  activatedAt?: string;
}

interface Lessee {
  id: string;
  name: string;
}

type StatusFilter = 'All' | 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export default function DirectDebitsPage() {
  const pathname = usePathname();
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';
  const [mandates, setMandates] = useState<DirectDebit[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    lesseeId: '',
    contractId: '',
    bankName: '',
    accountName: '',
    iban: '',
    collectionDay: '5',
    currency: 'AED',
    notes: '',
  });
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [mandatesRes, lesseesRes] = await Promise.all([
          fetch(`${apiBase}/direct-debits`),
          fetch('/api/leasing/lessees'),
        ]);

        if (!mandatesRes.ok || !lesseesRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const mandatesData = await mandatesRes.json();
        const lesseesData = await lesseesRes.json();

        setMandates(mandatesData.mandates || mandatesData);
        setLessees(lesseesData.lessees || lesseesData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [apiBase]);

  const handleCreateMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch(`${apiBase}/direct-debits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error('Failed to create mandate');

      const newMandate = await res.json();
      setMandates([...mandates, newMandate]);
      setShowModal(false);
      setFormData({
        lesseeId: '',
        contractId: '',
        bankName: '',
        accountName: '',
        iban: '',
        collectionDay: '5',
        currency: 'AED',
        notes: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mandate');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    if (newStatus === 'CANCELLED') {
      if (!confirm('Are you sure you want to cancel this mandate?')) return;
    }

    try {
      const res = await fetch(`${apiBase}/direct-debits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error('Failed to update mandate');

      const updated = await res.json();
      setMandates(mandates.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mandate');
    }
  };

  const filteredMandates =
    statusFilter === 'All' ? mandates : mandates.filter((m) => m.status === statusFilter);

  const summary = {
    total: mandates.length,
    active: mandates.filter((m) => m.status === 'ACTIVE').length,
    pending: mandates.filter((m) => m.status === 'PENDING').length,
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-amber-900 text-amber-200',
      ACTIVE: 'bg-emerald-900 text-emerald-200',
      SUSPENDED: 'bg-orange-900 text-orange-200',
      CANCELLED: 'bg-rose-900 text-rose-200',
    };
    return colors[status] || 'bg-gray-700 text-gray-200';
  };

  const maskIBAN = (iban: string) => {
    if (iban.length <= 4) return iban;
    return '*'.repeat(iban.length - 4) + iban.slice(-4);
  };

  const collectionDayText = (day: number) => {
    if (day === 28) return '28th of month';
    const suffix = day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
    return `${day}${suffix} of month`;
  };

  return (
    isLegacyPath ? (
      <LeasingBillingMigrationNotice
        title="Leasing direct debits"
        financeHref="/finance/leasing-billing/direct-debits"
        description="Mandate creation, suspension, and billing collections are now governed from Finance & Billing."
      />
    ) : (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Direct Debits</h1>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
          >
            +
            New Mandate
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <p className="text-gray-400 text-sm">Total Mandates</p>
            <p className="text-3xl font-bold text-white">{summary.total}</p>
          </div>
          <div className="bg-emerald-900 bg-opacity-20 p-4 rounded-lg border border-emerald-700">
            <p className="text-emerald-300 text-sm">Active Mandates</p>
            <p className="text-3xl font-bold text-emerald-200">{summary.active}</p>
          </div>
          <div className="bg-amber-900 bg-opacity-20 p-4 rounded-lg border border-amber-700">
            <p className="text-amber-300 text-sm">Pending Activation</p>
            <p className="text-3xl font-bold text-amber-200">{summary.pending}</p>
          </div>
        </div>

        {/* Status Filter */}
        <div className="mb-6 flex gap-2">
          {(['All', 'PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as StatusFilter[]).map(
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
                {status}
              </button>
            )
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && <p className="text-gray-400 text-center py-8">Loading mandates...</p>}

        {/* Table */}
        {!loading && filteredMandates.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Mandate Ref</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Lessee</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Bank</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Account Name</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">IBAN</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Collection Day</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Currency</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Status</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Activated At</th>
                  <th className="px-4 py-3 text-left text-gray-300 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMandates.map((mandate) => (
                  <tr key={mandate.id} className="border-b border-gray-700 hover:bg-gray-800">
                    <td className="px-4 py-3 text-white font-mono text-xs">{mandate.mandateRef}</td>
                    <td className="px-4 py-3 text-gray-200">{mandate.lessee.name}</td>
                    <td className="px-4 py-3 text-gray-300">{mandate.bankName}</td>
                    <td className="px-4 py-3 text-gray-300">{mandate.accountName}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{maskIBAN(mandate.iban)}</td>
                    <td className="px-4 py-3 text-gray-300">{collectionDayText(mandate.collectionDay)}</td>
                    <td className="px-4 py-3 text-gray-300">{mandate.currency}</td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(mandate.status)}`}>
                        {mandate.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {mandate.activatedAt ? new Date(mandate.activatedAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {mandate.status === 'PENDING' && (
                          <button
                            onClick={() => handleStatusChange(mandate.id, 'ACTIVE')}
                            className="p-1 bg-emerald-900 hover:bg-emerald-800 text-emerald-200 rounded transition"
                            title="Activate"
                          >
                            Activate
                          </button>
                        )}
                        {mandate.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleStatusChange(mandate.id, 'SUSPENDED')}
                            className="p-1 bg-orange-900 hover:bg-orange-800 text-orange-200 rounded transition"
                            title="Suspend"
                          >
                            Suspend
                          </button>
                        )}
                        {(mandate.status === 'ACTIVE' || mandate.status === 'SUSPENDED') && (
                          <button
                            onClick={() => handleStatusChange(mandate.id, 'CANCELLED')}
                            className="p-1 bg-rose-900 hover:bg-rose-800 text-rose-200 rounded transition"
                            title="Cancel"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredMandates.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">No mandates found</p>
          </div>
        )}
      </div>

      {/* New Mandate Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full border border-gray-700">
            <h2 className="text-xl font-bold text-white mb-4">New Direct Debit Mandate</h2>

            <form onSubmit={handleCreateMandate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Lessee</label>
                <select
                  required
                  value={formData.lesseeId}
                  onChange={(e) => setFormData({ ...formData, lesseeId: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select a lessee</option>
                  {lessees.map((lessee) => (
                    <option key={lessee.id} value={lessee.id}>
                      {lessee.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Contract ID (Optional)</label>
                <input
                  type="text"
                  value={formData.contractId}
                  onChange={(e) => setFormData({ ...formData, contractId: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Bank Name</label>
                <input
                  type="text"
                  required
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Account Name</label>
                <input
                  type="text"
                  required
                  value={formData.accountName}
                  onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">IBAN</label>
                <input
                  type="text"
                  required
                  value={formData.iban}
                  onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Collection Day (1-28)</label>
                <input
                  type="number"
                  min="1"
                  max="28"
                  required
                  value={formData.collectionDay}
                  onChange={(e) => setFormData({ ...formData, collectionDay: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Currency</label>
                <input
                  type="text"
                  required
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Notes (Optional)</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg transition font-medium"
                >
                  {submitting ? 'Creating...' : 'Create Mandate'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    )
  );
}
