'use client';
import React, { useState, useEffect } from 'react';

interface Receipt {
  id: string;
  receiptNumber: string;
  contractId: string;
  contractNumber: string;
  paymentType: 'DEPOSIT' | 'SECURITY' | 'MONTHLY' | 'ADVANCE' | 'PENALTY';
  amount: number;
  currency: string;
  receivedDate: string;
  paymentMethod: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'CARD';
  chequeNumber?: string;
  bankRef?: string;
  receivedBy: string;
  branch: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  lessee: string;
}

interface NewReceiptForm {
  contractId: string;
  paymentType: 'DEPOSIT' | 'SECURITY' | 'MONTHLY' | 'ADVANCE' | 'PENALTY';
  amount: string;
  currency: string;
  receivedDate: string;
  paymentMethod: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'CARD';
  chequeNumber: string;
  bankRef: string;
  receivedBy: string;
  branch: string;
  notes: string;
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewReceipt, setShowNewReceipt] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [newReceiptForm, setNewReceiptForm] = useState<NewReceiptForm>({
    contractId: '',
    paymentType: 'MONTHLY',
    amount: '',
    currency: 'AED',
    receivedDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'BANK_TRANSFER',
    chequeNumber: '',
    bankRef: '',
    receivedBy: '',
    branch: '',
    notes: '',
  });

  useEffect(() => {
    const mockReceipts: Receipt[] = [
      {
        id: '1',
        receiptNumber: 'RCP-001',
        contractId: '1',
        contractNumber: 'LC-V2-001',
        paymentType: 'SECURITY',
        amount: 15000,
        currency: 'AED',
        receivedDate: '2024-01-10',
        paymentMethod: 'BANK_TRANSFER',
        bankRef: 'TXN-20240110-001',
        receivedBy: 'Fatima Al-Mansouri',
        branch: 'Dubai HQ',
      },
      {
        id: '2',
        receiptNumber: 'RCP-002',
        contractId: '1',
        contractNumber: 'LC-V2-001',
        paymentType: 'MONTHLY',
        amount: 15000,
        currency: 'AED',
        receivedDate: '2024-02-01',
        paymentMethod: 'BANK_TRANSFER',
        bankRef: 'TXN-20240201-002',
        receivedBy: 'Ahmed Hassan',
        branch: 'Dubai HQ',
      },
      {
        id: '3',
        receiptNumber: 'RCP-003',
        contractId: '2',
        contractNumber: 'LC-V2-002',
        paymentType: 'DEPOSIT',
        amount: 7000,
        currency: 'AED',
        receivedDate: '2024-06-01',
        paymentMethod: 'CHEQUE',
        chequeNumber: 'CHQ-2024-001',
        receivedBy: 'Mohammed Al-Qasimi',
        branch: 'Abu Dhabi',
      },
      {
        id: '4',
        receiptNumber: 'RCP-004',
        contractId: '2',
        contractNumber: 'LC-V2-002',
        paymentType: 'MONTHLY',
        amount: 3500,
        currency: 'AED',
        receivedDate: '2024-07-01',
        paymentMethod: 'CARD',
        receivedBy: 'Hana Al-Mansouri',
        branch: 'Abu Dhabi',
      },
      {
        id: '5',
        receiptNumber: 'RCP-005',
        contractId: '3',
        contractNumber: 'LC-V2-003',
        paymentType: 'ADVANCE',
        amount: 5000,
        currency: 'AED',
        receivedDate: '2025-01-15',
        paymentMethod: 'CASH',
        receivedBy: 'Layla Al-Nakhli',
        branch: 'Dubai HQ',
      },
    ];

    const mockContracts: Contract[] = [
      { id: '1', contractNumber: 'LC-V2-001', lessee: 'Global Logistics LLC' },
      { id: '2', contractNumber: 'LC-V2-002', lessee: 'Ahmed Al-Mansouri' },
      { id: '3', contractNumber: 'LC-V2-003', lessee: 'Fatima Al-Nakhli' },
      { id: '4', contractNumber: 'LC-V2-004', lessee: 'Enterprise Corp' },
    ];

    Promise.all([
      fetch('/api/leasing/receipts').then(r => r.ok ? r.json() : []),
      fetch('/api/leasing/contracts-v2').then(r => r.ok ? r.json() : []),
    ])
      .then(([receiptsData, contractsData]) => {
        setReceipts(receiptsData.length ? receiptsData : mockReceipts);
        setContracts(contractsData.length ? contractsData : mockContracts);
      })
      .catch(() => { setReceipts(mockReceipts); setContracts(mockContracts); })
      .finally(() => setLoading(false));
  }, []);

  const getPaymentTypeBadgeStyle = (type: string) => {
    switch (type) {
      case 'DEPOSIT':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'SECURITY':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'MONTHLY':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'ADVANCE':
        return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'PENALTY':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const filteredReceipts = receipts.filter(r =>
    r.receiptNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.contractNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.receivedBy.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalReceipts: receipts.length,
    depositsCollected: receipts
      .filter(r => r.paymentType === 'DEPOSIT')
      .reduce((sum, r) => sum + r.amount, 0),
    securityDeposits: receipts
      .filter(r => r.paymentType === 'SECURITY')
      .reduce((sum, r) => sum + r.amount, 0),
    monthlyPayments: receipts
      .filter(r => r.paymentType === 'MONTHLY')
      .reduce((sum, r) => sum + r.amount, 0),
  };

  const handleCreateReceipt = async () => {
    const contractId = newReceiptForm.contractId;
    console.log('Creating receipt:', newReceiptForm);
    try {
      const response = await fetch(`/api/leasing/contracts-v2/${contractId}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReceiptForm),
      });
      if (response.ok) {
        setShowNewReceipt(false);
        setNewReceiptForm({
          contractId: '',
          paymentType: 'MONTHLY',
          amount: '',
          currency: 'AED',
          receivedDate: new Date().toISOString().split('T')[0],
          paymentMethod: 'BANK_TRANSFER',
          chequeNumber: '',
          bankRef: '',
          receivedBy: '',
          branch: '',
          notes: '',
        });
      }
    } catch (error) {
      console.error('Error creating receipt:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading receipts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Lease Receipts</h1>
          <p className="text-slate-400">Track all payment receipts and collections</p>
        </div>
        <button
          onClick={() => setShowNewReceipt(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          New Receipt
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Total Receipts</p>
          <p className="text-2xl font-bold text-white">{stats.totalReceipts}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Deposits Collected</p>
          <p className="text-2xl font-bold text-amber-400">{stats.depositsCollected.toLocaleString()} AED</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Security Deposits</p>
          <p className="text-2xl font-bold text-purple-400">{stats.securityDeposits.toLocaleString()} AED</p>
        </div>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
          <p className="text-slate-400 text-xs font-medium mb-1">Monthly Payments</p>
          <p className="text-2xl font-bold text-blue-400">{stats.monthlyPayments.toLocaleString()} AED</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
        <input
          type="text"
          placeholder="Search by Receipt #, Contract #, or Received By..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* Receipts Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Receipt #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Contract #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Payment Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Currency</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Received Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Payment Method</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Details</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Received By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Branch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredReceipts.map((receipt) => (
              <tr key={receipt.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-4 py-4 text-sm font-medium text-white">{receipt.receiptNumber}</td>
                <td className="px-4 py-4 text-sm font-medium text-blue-400">{receipt.contractNumber}</td>
                <td className="px-4 py-4 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPaymentTypeBadgeStyle(receipt.paymentType)}`}>
                    {receipt.paymentType}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm font-semibold text-white">
                  {receipt.amount.toLocaleString()}
                </td>
                <td className="px-4 py-4 text-sm text-slate-200">{receipt.currency}</td>
                <td className="px-4 py-4 text-sm text-slate-200">{receipt.receivedDate}</td>
                <td className="px-4 py-4 text-sm text-white">{receipt.paymentMethod}</td>
                <td className="px-4 py-4 text-sm text-slate-200">
                  {receipt.chequeNumber && <div>Chq: {receipt.chequeNumber}</div>}
                  {receipt.bankRef && <div>Ref: {receipt.bankRef}</div>}
                  {!receipt.chequeNumber && !receipt.bankRef && <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-4 text-sm text-white">{receipt.receivedBy}</td>
                <td className="px-4 py-4 text-sm text-slate-200">{receipt.branch}</td>
                <td className="px-4 py-4 text-sm">
                  <button className="text-blue-400 hover:text-blue-300 font-medium">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Receipt Modal */}
      {showNewReceipt && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Receipt</h2>
              <button
                onClick={() => setShowNewReceipt(false)}
                className="text-slate-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Contract</label>
                <select
                  value={newReceiptForm.contractId}
                  onChange={(e) => setNewReceiptForm({ ...newReceiptForm, contractId: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">Select a contract</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.contractNumber} - {contract.lessee}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Payment Type</label>
                  <select
                    value={newReceiptForm.paymentType}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, paymentType: e.target.value as any })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="DEPOSIT">Deposit</option>
                    <option value="SECURITY">Security Deposit</option>
                    <option value="MONTHLY">Monthly Payment</option>
                    <option value="ADVANCE">Advance Payment</option>
                    <option value="PENALTY">Penalty</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Amount</label>
                  <input
                    type="number"
                    value={newReceiptForm.amount}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, amount: e.target.value })}
                    placeholder="0"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Currency</label>
                  <select
                    value={newReceiptForm.currency}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, currency: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="AED">AED</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Received Date</label>
                  <input
                    type="date"
                    value={newReceiptForm.receivedDate}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, receivedDate: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Method</label>
                <select
                  value={newReceiptForm.paymentMethod}
                  onChange={(e) => setNewReceiptForm({ ...newReceiptForm, paymentMethod: e.target.value as any })}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CARD">Card</option>
                </select>
              </div>

              {newReceiptForm.paymentMethod === 'CHEQUE' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Cheque Number</label>
                  <input
                    type="text"
                    value={newReceiptForm.chequeNumber}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, chequeNumber: e.target.value })}
                    placeholder="e.g. CHQ-2024-001"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              )}

              {newReceiptForm.paymentMethod === 'BANK_TRANSFER' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Bank Reference</label>
                  <input
                    type="text"
                    value={newReceiptForm.bankRef}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, bankRef: e.target.value })}
                    placeholder="e.g. TXN-20240110-001"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Received By</label>
                  <input
                    type="text"
                    value={newReceiptForm.receivedBy}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, receivedBy: e.target.value })}
                    placeholder="Staff name"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Branch</label>
                  <select
                    value={newReceiptForm.branch}
                    onChange={(e) => setNewReceiptForm({ ...newReceiptForm, branch: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">Select branch</option>
                    <option value="Dubai HQ">Dubai HQ</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={newReceiptForm.notes}
                  onChange={(e) => setNewReceiptForm({ ...newReceiptForm, notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowNewReceipt(false)}
                  className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-white hover:bg-white/5 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateReceipt}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 font-medium text-white hover:opacity-90 transition-opacity"
                >
                  Create Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
