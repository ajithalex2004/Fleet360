'use client';
import React, { useState, useEffect } from 'react';

interface Payment {
  id: string;
  contractId: string;
  lessee: string;
  dueDate: string;
  amount: number;
  status: string;
  receiptNo: string;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const mockPayments: Payment[] = [
      {
        id: 'PM-001',
        contractId: 'LC-001',
        lessee: 'Ahmed Al-Mansouri',
        dueDate: '2024-02-15',
        amount: 6500,
        status: 'Paid',
        receiptNo: 'RCP-2024-001',
      },
      {
        id: 'PM-002',
        contractId: 'LC-002',
        lessee: 'Fatima Al-Nakhli',
        dueDate: '2024-02-20',
        amount: 9800,
        status: 'Paid',
        receiptNo: 'RCP-2024-002',
      },
      {
        id: 'PM-003',
        contractId: 'LC-003',
        lessee: 'Global Logistics LLC',
        dueDate: '2024-03-01',
        amount: 8500,
        status: 'Pending',
        receiptNo: '',
      },
      {
        id: 'PM-004',
        contractId: 'LC-004',
        lessee: 'Mohammed Al-Qasimi',
        dueDate: '2024-02-10',
        amount: 5800,
        status: 'Overdue',
        receiptNo: '',
      },
      {
        id: 'PM-005',
        contractId: 'LC-001',
        lessee: 'Ahmed Al-Mansouri',
        dueDate: '2024-03-15',
        amount: 6500,
        status: 'Pending',
        receiptNo: '',
      },
      {
        id: 'PM-006',
        contractId: 'LC-002',
        lessee: 'Fatima Al-Nakhli',
        dueDate: '2024-02-01',
        amount: 9800,
        status: 'Overdue',
        receiptNo: '',
      },
      {
        id: 'PM-007',
        contractId: 'LC-005',
        lessee: 'Nawal Al-Maktoum',
        dueDate: '2024-03-05',
        amount: 7200,
        status: 'Paid',
        receiptNo: 'RCP-2024-003',
      },
    ];

    setPayments(mockPayments);
    setLoading(false);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'Overdue':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const paidCount = payments.filter((p) => p.status === 'Paid').length;
  const pendingCount = payments.filter((p) => p.status === 'Pending').length;
  const overdueCount = payments.filter((p) => p.status === 'Overdue').length;
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Payment Schedule</h1>
        <p className="text-slate-400">Track all contract payment statuses</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Total Amount</h3>
          <p className="text-2xl font-bold text-white">AED {totalAmount.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-2">All payments</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Paid</h3>
          <p className="text-2xl font-bold text-emerald-400">{paidCount}</p>
          <p className="text-xs text-slate-500 mt-2">Completed</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Pending</h3>
          <p className="text-2xl font-bold text-amber-400">{pendingCount}</p>
          <p className="text-xs text-slate-500 mt-2">Awaiting payment</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-slate-400 mb-4">Overdue</h3>
          <p className="text-2xl font-bold text-rose-400">{overdueCount}</p>
          <p className="text-xs text-slate-500 mt-2">Action required</p>
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Contract #</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Lessee</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Due Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Amount</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Receipt No</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{payment.contractId}</td>
                <td className="px-6 py-4 text-sm text-white">{payment.lessee}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{payment.dueDate}</td>
                <td className="px-6 py-4 text-sm font-medium text-white">AED {payment.amount.toLocaleString()}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(payment.status)}`}>
                    {payment.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-mono text-slate-200">{payment.receiptNo || '—'}</td>
                <td className="px-6 py-4 text-sm">
                  <button className="text-blue-400 hover:text-blue-300 transition-colors">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
