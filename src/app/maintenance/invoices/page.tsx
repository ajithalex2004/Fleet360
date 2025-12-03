'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    Invoice,
    PaymentStatus,
    InvoiceCategory,
    MaintenanceRequest,
    Garage,
    WorkOrder
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getGarages
} from '@/services/mockData';

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [garages, setGarages] = useState<Record<string, Garage>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState(0);

    // Mock invoice data
    const mockInvoices: Invoice[] = [
        {
            id: 'inv-001',
            invoiceNumber: 'INV-2024-001',
            requestId: 'req-001',
            workOrderId: 'wo-001',
            garageId: 'g1',
            invoiceDate: '2024-11-20',
            dueDate: '2024-12-05',
            laborCost: 450,
            partsCost: 320,
            taxAmount: 77,
            discountAmount: 0,
            totalAmount: 847,
            paidAmount: 847,
            paymentStatus: PaymentStatus.PAID,
            paymentDate: '2024-11-22',
            lineItems: [
                { id: 'li-1', description: 'Engine Diagnostic', quantity: 2, unitPrice: 150, totalPrice: 300, category: InvoiceCategory.LABOR },
                { id: 'li-2', description: 'Oil Change', quantity: 1, unitPrice: 150, totalPrice: 150, category: InvoiceCategory.LABOR },
                { id: 'li-3', description: 'Oil Filter', quantity: 2, unitPrice: 25, totalPrice: 50, category: InvoiceCategory.PARTS },
                { id: 'li-4', description: 'Engine Oil (5L)', quantity: 2, unitPrice: 135, totalPrice: 270, category: InvoiceCategory.PARTS }
            ],
            attachments: []
        },
        {
            id: 'inv-002',
            invoiceNumber: 'INV-2024-002',
            requestId: 'req-002',
            workOrderId: 'wo-002',
            garageId: 'g2',
            invoiceDate: '2024-11-22',
            dueDate: '2024-12-07',
            laborCost: 600,
            partsCost: 1200,
            taxAmount: 180,
            discountAmount: 100,
            totalAmount: 1880,
            paidAmount: 0,
            paymentStatus: PaymentStatus.UNPAID,
            lineItems: [
                { id: 'li-5', description: 'Brake System Repair', quantity: 4, unitPrice: 150, totalPrice: 600, category: InvoiceCategory.LABOR },
                { id: 'li-6', description: 'Brake Pads (Set)', quantity: 2, unitPrice: 400, totalPrice: 800, category: InvoiceCategory.PARTS },
                { id: 'li-7', description: 'Brake Discs (Pair)', quantity: 1, unitPrice: 400, totalPrice: 400, category: InvoiceCategory.PARTS }
            ],
            attachments: []
        },
        {
            id: 'inv-003',
            invoiceNumber: 'INV-2024-003',
            requestId: 'req-003',
            workOrderId: 'wo-003',
            garageId: 'g1',
            invoiceDate: '2024-11-15',
            dueDate: '2024-11-30',
            laborCost: 300,
            partsCost: 450,
            taxAmount: 75,
            discountAmount: 0,
            totalAmount: 825,
            paidAmount: 400,
            paymentStatus: PaymentStatus.PARTIALLY_PAID,
            lineItems: [
                { id: 'li-8', description: 'AC Service', quantity: 2, unitPrice: 150, totalPrice: 300, category: InvoiceCategory.LABOR },
                { id: 'li-9', description: 'AC Refrigerant', quantity: 3, unitPrice: 150, totalPrice: 450, category: InvoiceCategory.PARTS }
            ],
            attachments: []
        }
    ];

    useEffect(() => {
        const fetchData = async () => {
            const allGarages = await getGarages();

            const garMap = allGarages.reduce((acc, g) => {
                acc[g.id] = g;
                return acc;
            }, {} as Record<string, Garage>);
            setGarages(garMap);

            // Check for overdue invoices
            const today = new Date();
            const invoicesWithStatus = mockInvoices.map(inv => {
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
                return 'bg-green-100 text-green-700 border-green-300';
            case PaymentStatus.PARTIALLY_PAID:
                return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case PaymentStatus.UNPAID:
                return 'bg-slate-100 text-slate-700 border-slate-300';
            case PaymentStatus.OVERDUE:
                return 'bg-red-100 text-red-700 border-red-300';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-300';
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
                <h1 className="text-2xl font-bold text-slate-900">Invoice Management</h1>
                <p className="mt-1 text-slate-500">Track and manage maintenance invoices and payments</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-500">Total Expense</p>
                            <p className="text-2xl font-bold text-slate-900">AED {totalRevenue.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-blue-100 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-blue-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-green-200 bg-green-50 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-green-700">Paid</p>
                            <p className="text-2xl font-bold text-green-900">AED {totalPaid.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-green-200 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-green-700">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-700">Outstanding</p>
                            <p className="text-2xl font-bold text-yellow-900">AED {totalOutstanding.toLocaleString()}</p>
                        </div>
                        <div className="rounded-full bg-yellow-200 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-yellow-700">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-red-700">Overdue</p>
                            <p className="text-2xl font-bold text-red-900">{overdueCount}</p>
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
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                >
                    All
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.PAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.PAID
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                >
                    Paid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.PARTIALLY_PAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.PARTIALLY_PAID
                        ? 'bg-yellow-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                >
                    Partially Paid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.UNPAID)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.UNPAID
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                >
                    Unpaid
                </button>
                <button
                    onClick={() => setFilter(PaymentStatus.OVERDUE)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${filter === PaymentStatus.OVERDUE
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                >
                    Overdue
                </button>
            </div>

            {/* Invoices Table */}
            <div className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
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
                    <tbody className="divide-y divide-slate-200 bg-white">
                        {filteredInvoices.map(invoice => {
                            const garage = garages[invoice.garageId];
                            const balance = invoice.totalAmount - invoice.paidAmount;

                            return (
                                <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="text-sm font-medium text-blue-600">{invoice.invoiceNumber}</div>
                                        <div className="text-xs text-slate-500">Req: #{invoice.requestId.toUpperCase()}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="text-sm text-slate-900">{garage?.name || 'Unknown'}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                                        {new Date(invoice.invoiceDate).toLocaleDateString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                                        {new Date(invoice.dueDate).toLocaleDateString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">
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
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">Record Payment</h3>
                                <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500">Invoice Number</label>
                                        <p className="text-sm font-medium text-slate-900">{selectedInvoice.invoiceNumber}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500">Total Amount</label>
                                        <p className="text-sm font-medium text-slate-900">AED {selectedInvoice.totalAmount.toLocaleString()}</p>
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
                                <label className="block text-sm font-medium text-slate-700 mb-2">Payment Amount (AED)</label>
                                <input
                                    type="number"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                                    max={selectedInvoice.totalAmount - selectedInvoice.paidAmount}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900 text-lg font-medium"
                                />
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-700">New Balance:</span>
                                    <span className="text-xl font-bold text-blue-600">
                                        AED {Math.max(0, selectedInvoice.totalAmount - selectedInvoice.paidAmount - paymentAmount).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowPaymentModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
        </div>
    );
}
