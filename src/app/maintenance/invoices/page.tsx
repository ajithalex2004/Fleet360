'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    Invoice,
    PaymentStatus,
    InvoiceCategory,
    MaintenanceRequest,
    Garage,
    MaintenanceStatus,
    WorkOrder,
    Attachment,
    AttachmentType
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getGarages,
    getInvoices,
    createInvoice,
    updateMaintenanceRequest
} from '@/services/mockData';

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [garages, setGarages] = useState<Record<string, Garage>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState(0);

    // Add Invoice State
    const [showAddModal, setShowAddModal] = useState(false);
    const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
    const [newInvoiceData, setNewInvoiceData] = useState({
        invoiceNumber: '',
        garageId: '',
        requestId: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: '',
        laborCost: 0,
        partsCost: 0,
        taxAmount: 0,
        discountAmount: 0,
        attachments: [] as Attachment[]
    });



    useEffect(() => {
        const fetchData = async () => {
            const [allGarages, allInvoices, allRequests] = await Promise.all([
                getGarages(),
                getInvoices(),
                getMaintenanceRequests()
            ]);

            const garMap = allGarages.reduce((acc, g) => {
                acc[g.id] = g;
                return acc;
            }, {} as Record<string, Garage>);
            setGarages(garMap);
            setMaintenanceRequests(allRequests);

            // Check for overdue invoices
            const today = new Date();
            const invoicesWithStatus = allInvoices.map(inv => {
                if (inv.paymentStatus === PaymentStatus.UNPAID && new Date(inv.dueDate) < today) {
                    return { ...inv, paymentStatus: PaymentStatus.OVERDUE };
                }
                return inv;
            });

            setInvoices(invoicesWithStatus);
            setLoading(false);
        };
        fetchData();
    }, []);

    const handleAddInvoice = async () => {
        if (!newInvoiceData.invoiceNumber || !newInvoiceData.garageId || !newInvoiceData.requestId) {
            alert('Please fill in all required fields');
            return;
        }

        const totalAmount = newInvoiceData.laborCost + newInvoiceData.partsCost + newInvoiceData.taxAmount - newInvoiceData.discountAmount;

        const newInvoice: Invoice = {
            id: `inv-${Date.now()}`,
            invoiceNumber: newInvoiceData.invoiceNumber,
            requestId: newInvoiceData.requestId,
            workOrderId: `wo-${Date.now()}`, // Placeholder
            garageId: newInvoiceData.garageId,
            invoiceDate: newInvoiceData.invoiceDate,
            dueDate: newInvoiceData.dueDate,
            laborCost: newInvoiceData.laborCost,
            partsCost: newInvoiceData.partsCost,
            taxAmount: newInvoiceData.taxAmount,
            discountAmount: newInvoiceData.discountAmount,
            totalAmount: totalAmount,
            paidAmount: 0,
            paymentStatus: PaymentStatus.UNPAID,
            paidAmount: 0,
            paymentStatus: PaymentStatus.UNPAID,
            lineItems: [], // Simplified for now
            attachments: newInvoiceData.attachments // Use selected attachments
        };

        await createInvoice(newInvoice);

        // Update Maintenance Request Status
        await updateMaintenanceRequest(newInvoiceData.requestId, {
            status: MaintenanceStatus.INVOICE_SUBMITTED
        });

        // Refresh Data
        const allInvoices = await getInvoices();
        const today = new Date();
        const invoicesWithStatus = allInvoices.map(inv => {
            if (inv.paymentStatus === PaymentStatus.UNPAID && new Date(inv.dueDate) < today) {
                return { ...inv, paymentStatus: PaymentStatus.OVERDUE };
            }
            return inv;
        });
        setInvoices(invoicesWithStatus);

        setShowAddModal(false);
        setNewInvoiceData({
            invoiceNumber: '',
            garageId: '',
            requestId: '',
            invoiceDate: new Date().toISOString().split('T')[0],
            dueDate: '',
            laborCost: 0,
            partsCost: 0,
            taxAmount: 0,
            discountAmount: 0,
            attachments: []
        });
        alert('Invoice added successfully!');
    };

    const handleRecordPayment = () => {
        if (!selectedInvoice || paymentAmount <= 0) {
            alert('Please enter a valid payment amount');
            return;
        }

        const newPaidAmount = selectedInvoice.paidAmount + paymentAmount;
        const newStatus = newPaidAmount >= selectedInvoice.totalAmount
            ? PaymentStatus.PAID
            : PaymentStatus.PARTIALLY_PAID;

        const updatedInvoices = invoices.map(inv => {
            if (inv.id === selectedInvoice.id) {
                return {
                    ...inv,
                    paidAmount: newPaidAmount,
                    paymentStatus: newStatus,
                    paymentDate: newStatus === PaymentStatus.PAID ? new Date().toISOString() : inv.paymentDate
                };
            }
            return inv;
        });

        setInvoices(updatedInvoices);
        setShowPaymentModal(false);
        setPaymentAmount(0);
        setSelectedInvoice(null);
        alert('Payment recorded successfully!');
    };

    const getStatusColor = (status: PaymentStatus) => {
        switch (status) {
            case PaymentStatus.PAID:
                return 'bg-emerald-500/20 text-green-700 border-green-300';
            case PaymentStatus.PARTIALLY_PAID:
                return 'bg-amber-500/20 text-yellow-700 border-yellow-300';
            case PaymentStatus.UNPAID:
                return 'bg-slate-700/40 text-slate-300 border-white/15';
            case PaymentStatus.OVERDUE:
                return 'bg-red-500/20 text-red-700 border-red-300';
            default:
                return 'bg-slate-700/40 text-slate-300 border-white/15';
        }
    };

    const filteredInvoices = invoices.filter(inv => {
        if (filter === 'all') return true;
        return inv.paymentStatus === filter;
    });

    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const totalOutstanding = totalRevenue - totalPaid;
    const overdueCount = invoices.filter(inv => inv.paymentStatus === PaymentStatus.OVERDUE).length;

    if (loading) return <div className="p-8 text-center text-slate-500">Loading invoices...</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Invoice Management</h1>
                <div className="flex justify-between items-center mt-1">
                    <p className="text-slate-500">Track and manage maintenance invoices and payments</p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add Invoice
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-500">Total Expense</p>
                            <p className="text-2xl font-bold text-white">AED {totalRevenue.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-blue-500/20 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-blue-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-green-200 bg-emerald-500/10 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-green-700">Paid</p>
                            <p className="text-2xl font-bold text-emerald-300">AED {totalPaid.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-green-200 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-green-700">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-yellow-200 bg-amber-500/10 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-700">Outstanding</p>
                            <p className="text-2xl font-bold text-amber-300">AED {totalOutstanding.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-yellow-200 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-yellow-700">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-500/10 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-red-700">Overdue</p>
                            <p className="text-2xl font-bold text-red-300">{overdueCount}</p>
                        </div>
                        <div className="rounded-full bg-red-200 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-red-700">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                        }`}
                >
                    All
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.PAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.PAID
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                        }`}
                >
                    Paid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.PARTIALLY_PAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.PARTIALLY_PAID
                        ? 'bg-yellow-600 text-white'
                        : 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                        }`}
                >
                    Partially Paid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.UNPAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.UNPAID
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                        }`}
                >
                    Unpaid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.OVERDUE)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.OVERDUE
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                        }`}
                >
                    Overdue
                </button>
            </div>

            {/* Invoices Table */}
            <div className="overflow-visible rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <table className="min-w-full divide-y divide-white/10">
                    <thead className="bg-slate-800/50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Invoice #</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Garage</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Due Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Total</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Paid</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-slate-900">
                        {filteredInvoices.map(invoice => {
                            const garage = garages[invoice.garageId];
                            const balance = invoice.totalAmount - invoice.paidAmount;

                            return (
                                <tr key={invoice.id} className="hover:bg-white/5 transition-colors">
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="text-sm font-medium text-blue-600">{invoice.invoiceNumber}</div>
                                        <div className="text-xs text-slate-300">Req: #{invoice.requestId.toUpperCase()}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="text-sm text-white">{garage?.name || 'Unknown'}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-300">
                                        {new Date(invoice.invoiceDate).toLocaleDateString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-300">
                                        {new Date(invoice.dueDate).toLocaleDateString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">
                                        AED {invoice.totalAmount.toLocaleString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="text-sm font-medium text-green-600">AED {invoice.paidAmount.toLocaleString()}</div>
                                        {balance > 0 && (
                                            <div className="text-xs text-red-600">Balance: AED {balance.toLocaleString()}</div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getStatusColor(invoice.paymentStatus)}`}>
                                            {invoice.paymentStatus}
                                        </span>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {invoice.paymentStatus !== PaymentStatus.PAID && (
                                            <button
                                                onClick={() => {
                                                    setSelectedInvoice(invoice);
                                                    setPaymentAmount(balance);
                                                    setShowPaymentModal(true);
                                                }}
                                                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                                Record Payment
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Payment Modal */}
            {showPaymentModal && selectedInvoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">Record Payment</h3>
                                <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="rounded-lg border border-white/10 bg-slate-800/50 p-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500">Invoice Number</label>
                                        <p className="text-sm font-medium text-white">{selectedInvoice.invoiceNumber}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500">Total Amount</label>
                                        <p className="text-sm font-medium text-white">AED {selectedInvoice.totalAmount.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500">Already Paid</label>
                                        <p className="text-sm font-medium text-green-600">AED {selectedInvoice.paidAmount.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500">Balance Due</label>
                                        <p className="text-sm font-medium text-red-600">
                                            AED {(selectedInvoice.totalAmount - selectedInvoice.paidAmount).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Amount (AED)</label>
                                <input
                                    type="number"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                                    max={selectedInvoice.totalAmount - selectedInvoice.paidAmount}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white text-lg font-medium"
                                />
                            </div>

                            <div className="bg-blue-500/10 border border-blue-200 rounded-lg p-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-300">New Balance:</span>
                                    <span className="text-xl font-bold text-blue-600">
                                        AED {Math.max(0, selectedInvoice.totalAmount - selectedInvoice.paidAmount - paymentAmount).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                            <button
                                onClick={() => setShowPaymentModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRecordPayment}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Record Payment
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Invoice Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">Add New Invoice</h3>
                                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Invoice Number</label>
                                    <input
                                        type="text"
                                        value={newInvoiceData.invoiceNumber}
                                        onChange={(e) => setNewInvoiceData({ ...newInvoiceData, invoiceNumber: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                        placeholder="INV-..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Garage</label>
                                    <select
                                        value={newInvoiceData.garageId}
                                        onChange={(e) => setNewInvoiceData({ ...newInvoiceData, garageId: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                    >
                                        <option value="">Select Garage</option>
                                        {Object.values(garages).map(g => (
                                            <option key={g.id} value={g.id}>{g.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <label className="block text-sm font-medium text-slate-300 mb-1">Work Order</label>
                                <select
                                    value={newInvoiceData.requestId}
                                    onChange={(e) => {
                                        const reqId = e.target.value;
                                        const selectedReq = maintenanceRequests.find(r => r.id === reqId);

                                        // Calculate Tax (Total - Parts - Labor - Other) or default 0
                                        const parts = selectedReq?.actualPartsCost || 0;
                                        const labor = selectedReq?.actualLaborCost || 0;
                                        const other = selectedReq?.actualOtherCost || 0;
                                        const total = selectedReq?.actualCost || 0;
                                        const tax = Math.max(0, total - parts - labor - other);

                                        // Find Invoice Attachment - strictly look for INVOICE type
                                        // The backend logic for SUBMIT_INVOICE ensures the attachment is synced to request.attachments
                                        const invoiceAttachment = selectedReq?.attachments?.find(att => att.type === 'INVOICE');

                                        setNewInvoiceData({
                                            ...newInvoiceData,
                                            requestId: reqId,
                                            garageId: selectedReq?.garageId || newInvoiceData.garageId || '',
                                            laborCost: labor,
                                            partsCost: parts,
                                            taxAmount: tax,
                                            attachments: invoiceAttachment ? [invoiceAttachment] : []
                                        });
                                    }}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm"
                                >
                                    <option value="">Select Work Order</option>
                                    {maintenanceRequests
                                        .filter(r => r.status === MaintenanceStatus.INVOICE_SUBMITTED)
                                        .map(r => (
                                            <option key={r.id} value={r.id}>
                                                {r.workOrderNo || r.id}
                                            </option>
                                        ))}
                                </select>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Invoice Date</label>
                                    <input
                                        type="date"
                                        value={newInvoiceData.invoiceDate}
                                        onChange={(e) => setNewInvoiceData({ ...newInvoiceData, invoiceDate: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Due Date</label>
                                    <input
                                        type="date"
                                        value={newInvoiceData.dueDate}
                                        onChange={(e) => setNewInvoiceData({ ...newInvoiceData, dueDate: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                    />
                                </div>
                            </div>

                            <div className="border-t border-white/10 pt-4">
                                <h4 className="text-sm font-medium text-white mb-3">Cost Breakdown</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Labor Cost</label>
                                        <input
                                            type="number"
                                            value={newInvoiceData.laborCost}
                                            onChange={(e) => setNewInvoiceData({ ...newInvoiceData, laborCost: Number(e.target.value) })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Parts Cost</label>
                                        <input
                                            type="number"
                                            value={newInvoiceData.partsCost}
                                            onChange={(e) => setNewInvoiceData({ ...newInvoiceData, partsCost: Number(e.target.value) })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Tax Amount</label>
                                        <input
                                            type="number"
                                            value={newInvoiceData.taxAmount}
                                            onChange={(e) => setNewInvoiceData({ ...newInvoiceData, taxAmount: Number(e.target.value) })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Discount</label>
                                        <input
                                            type="number"
                                            value={newInvoiceData.discountAmount}
                                            onChange={(e) => setNewInvoiceData({ ...newInvoiceData, discountAmount: Number(e.target.value) })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-800/50 p-4 rounded-lg flex justify-between items-center">
                                <span className="font-medium text-slate-300">Total Amount</span>
                                <span className="text-xl font-bold text-white">
                                    AED {(newInvoiceData.laborCost + newInvoiceData.partsCost + newInvoiceData.taxAmount - newInvoiceData.discountAmount).toLocaleString()}
                                </span>
                            </div>

                            {/* Attachments Section */}
                            <div className="border-t border-white/10 pt-4">
                                <h4 className="text-sm font-medium text-white mb-2">Attachments</h4>
                                {newInvoiceData.attachments && newInvoiceData.attachments.length > 0 ? (
                                    <div className="flex gap-2">
                                        {newInvoiceData.attachments.map(att => (
                                            <div key={att.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/50 border border-white/10 text-xs">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-blue-600">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                                </svg>
                                                <a href={att.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]">
                                                    {att.fileName}
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500 italic">No invoice attachment found.</p>
                                )}
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddInvoice}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Create Invoice
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
