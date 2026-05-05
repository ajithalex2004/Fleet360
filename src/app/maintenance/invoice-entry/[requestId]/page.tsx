'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    EnhancedMaintenanceRequest,
    EnhancedInvoice,
    EnhancedInvoiceLineItem,
    PaymentStatus,
    PartSource,
    MaintenanceStatus
} from '@/types/maintenance';
import { getMaintenanceRequests } from '@/services/mockData';
import { formatCurrency, calculateTax, addTax } from '@/utils/currency';

export default function InvoiceEntryPage() {
    const params = useParams();
    const router = useRouter();
    const requestId = params.requestId as string;

    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [loading, setLoading] = useState(true);
    const [lineItems, setLineItems] = useState<EnhancedInvoiceLineItem[]>([]);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState('');
    const [taxRate, setTaxRate] = useState(0.05); // 5% VAT
    const [showAddItemModal, setShowAddItemModal] = useState(false);
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
    const [itemForm, setItemForm] = useState({
        type: 'PART' as 'PART' | 'LABOR' | 'OTHER',
        description: '',
        quantity: 1,
        unitPrice: 0,
        partNumber: '',
        partSource: 'ORDERED' as PartSource,
        laborHours: 0,
        technicianName: ''
    });

    useEffect(() => {
        const fetchData = async () => {
            const requests = await getMaintenanceRequests();
            const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;

            if (!foundRequest) {
                router.push('/maintenance/requests');
                return;
            }

            setRequest(foundRequest);

            // Auto-generate invoice number
            setInvoiceNumber(`INV-${foundRequest.id.toUpperCase()}-${Date.now()}`);

            // Set due date to 30 days from now
            const dueDateCalc = new Date();
            dueDateCalc.setDate(dueDateCalc.getDate() + 30);
            setDueDate(dueDateCalc.toISOString().split('T')[0]);

            setLoading(false);
        };

        fetchData();
    }, [requestId, router]);

    const calculateTotals = () => {
        const partsTotal = lineItems
            .filter(item => item.type === 'PART')
            .reduce((sum, item) => sum + item.totalPrice, 0);

        const laborTotal = lineItems
            .filter(item => item.type === 'LABOR')
            .reduce((sum, item) => sum + item.totalPrice, 0);

        const otherCharges = lineItems
            .filter(item => item.type === 'OTHER')
            .reduce((sum, item) => sum + item.totalPrice, 0);

        const subtotal = partsTotal + laborTotal + otherCharges;
        const taxAmount = calculateTax(subtotal, taxRate);
        const grandTotal = subtotal + taxAmount;

        return { partsTotal, laborTotal, otherCharges, subtotal, taxAmount, grandTotal };
    };

    const handleAddItem = () => {
        const totalPrice = itemForm.quantity * itemForm.unitPrice;

        const newItem: EnhancedInvoiceLineItem = {
            id: `item-${Date.now()}`,
            type: itemForm.type,
            description: itemForm.description,
            quantity: itemForm.quantity,
            unitPrice: itemForm.unitPrice,
            totalPrice,
            ...(itemForm.type === 'PART' && {
                partNumber: itemForm.partNumber,
                partSource: itemForm.partSource
            }),
            ...(itemForm.type === 'LABOR' && {
                laborHours: itemForm.laborHours,
                technicianName: itemForm.technicianName
            })
        };

        if (editingItemIndex !== null) {
            const updated = [...lineItems];
            updated[editingItemIndex] = newItem;
            setLineItems(updated);
            setEditingItemIndex(null);
        } else {
            setLineItems([...lineItems, newItem]);
        }

        setShowAddItemModal(false);
        resetItemForm();
    };

    const handleEditItem = (index: number) => {
        const item = lineItems[index];
        setItemForm({
            type: item.type,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            partNumber: item.partNumber || '',
            partSource: item.partSource || 'ORDERED',
            laborHours: item.laborHours || 0,
            technicianName: item.technicianName || ''
        });
        setEditingItemIndex(index);
        setShowAddItemModal(true);
    };

    const handleDeleteItem = (index: number) => {
        setLineItems(lineItems.filter((_, i) => i !== index));
    };

    const resetItemForm = () => {
        setItemForm({
            type: 'PART',
            description: '',
            quantity: 1,
            unitPrice: 0,
            partNumber: '',
            partSource: 'ORDERED',
            laborHours: 0,
            technicianName: ''
        });
    };

    const handleSubmitInvoice = async () => {
        if (lineItems.length === 0) {
            alert('Please add at least one line item');
            return;
        }

        if (!invoiceNumber || !invoiceDate || !dueDate) {
            alert('Please fill in all invoice details');
            return;
        }

        const totals = calculateTotals();

        const invoice: EnhancedInvoice = {
            id: `inv-${Date.now()}`,
            invoiceNumber,
            requestId: request!.id,
            workOrderNumber: `WO-${request!.id.toUpperCase()}`,
            garageId: request!.garageId || 'unknown',
            garageName: 'Selected Garage', // TODO: Get from request
            invoiceDate,
            dueDate,
            lineItems,
            partsTotal: totals.partsTotal,
            laborTotal: totals.laborTotal,
            otherCharges: totals.otherCharges,
            subtotal: totals.subtotal,
            taxRate,
            taxAmount: totals.taxAmount,
            grandTotal: totals.grandTotal,
            currency: 'AED',
            invoiceDocument: '', // TODO: Upload document
            paidAmount: 0,
            paymentStatus: PaymentStatus.UNPAID,
            createdAt: new Date().toISOString(),
            createdBy: 'operations-user'
        };

        // TODO: Save to backend
        alert('Invoice submitted successfully!');
        router.push(`/maintenance/requests/${request!.id}`);
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found</div>;

    const totals = calculateTotals();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Invoice Entry</h1>
                <p className="mt-1 text-slate-500">Request #{request.id.toUpperCase()}</p>
            </div>

            {/* Invoice Details */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4">Invoice Information</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Invoice Number</label>
                        <input
                            type="text"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Invoice Date</label>
                        <input
                            type="date"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Due Date</label>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Tax Rate (%)</label>
                        <input
                            type="number"
                            value={taxRate * 100}
                            onChange={(e) => setTaxRate(Number(e.target.value) / 100)}
                            step="0.1"
                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                        />
                    </div>
                </div>
            </div>

            {/* Line Items */}
            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Line Items ({lineItems.length})</h3>
                    <button
                        onClick={() => {
                            resetItemForm();
                            setShowAddItemModal(true);
                        }}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        Add Line Item
                    </button>
                </div>

                {lineItems.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                        <p className="font-medium">No line items added</p>
                        <p className="text-sm text-slate-400 mt-1">Click "Add Line Item" to get started</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-white/10">
                            <thead className="bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Type</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Description</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Quantity</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Unit Price</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Total</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 bg-slate-900">
                                {lineItems.map((item, index) => (
                                    <tr key={item.id} className="hover:bg-white/5">
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${item.type === 'PART' ? 'bg-blue-500/20 text-blue-700 border-blue-300' :
                                                    item.type === 'LABOR' ? 'bg-emerald-500/20 text-green-700 border-green-300' :
                                                        'bg-purple-500/20 text-purple-700 border-purple-300'
                                                }`}>
                                                {item.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-white">{item.description}</div>
                                            {item.partNumber && (
                                                <div className="text-xs text-slate-300">Part #: {item.partNumber}</div>
                                            )}
                                            {item.technicianName && (
                                                <div className="text-xs text-slate-300">Tech: {item.technicianName}</div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-white">
                                            {item.quantity}
                                            {item.laborHours && <span className="text-slate-300"> ({item.laborHours}h)</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-white">
                                            {formatCurrency(item.unitPrice)}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">
                                            {formatCurrency(item.totalPrice)}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleEditItem(index)}
                                                    className="text-blue-600 hover:text-blue-300 text-sm"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteItem(index)}
                                                    className="text-red-600 hover:text-red-300 text-sm"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Totals Summary */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4">Invoice Summary</h3>
                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Parts Total:</span>
                        <span className="font-medium text-white">{formatCurrency(totals.partsTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Labor Total:</span>
                        <span className="font-medium text-white">{formatCurrency(totals.laborTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Other Charges:</span>
                        <span className="font-medium text-white">{formatCurrency(totals.otherCharges)}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-3 border-t border-white/10">
                        <span className="text-slate-600">Subtotal:</span>
                        <span className="font-medium text-white">{formatCurrency(totals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tax ({(taxRate * 100).toFixed(1)}%):</span>
                        <span className="font-medium text-white">{formatCurrency(totals.taxAmount)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold pt-3 border-t-2 border-white/15">
                        <span className="text-white">Grand Total:</span>
                        <span className="text-blue-600">{formatCurrency(totals.grandTotal)}</span>
                    </div>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={() => router.back()}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmitInvoice}
                    disabled={lineItems.length === 0}
                    className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                >
                    Submit Invoice
                </button>
            </div>

            {/* Add/Edit Line Item Modal */}
            {showAddItemModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-white/10 sticky top-0 bg-slate-900">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">
                                    {editingItemIndex !== null ? 'Edit' : 'Add'} Line Item
                                </h3>
                                <button onClick={() => {
                                    setShowAddItemModal(false);
                                    setEditingItemIndex(null);
                                    resetItemForm();
                                }} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Item Type</label>
                                <select
                                    value={itemForm.type}
                                    onChange={(e) => setItemForm({ ...itemForm, type: e.target.value as any })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                >
                                    <option value="PART">Part</option>
                                    <option value="LABOR">Labor</option>
                                    <option value="OTHER">Other</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
                                <input
                                    type="text"
                                    value={itemForm.description}
                                    onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    placeholder="Enter item description..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Quantity *</label>
                                    <input
                                        type="number"
                                        value={itemForm.quantity}
                                        onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                                        min="1"
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Unit Price (AED) *</label>
                                    <input
                                        type="number"
                                        value={itemForm.unitPrice}
                                        onChange={(e) => setItemForm({ ...itemForm, unitPrice: Number(e.target.value) })}
                                        min="0"
                                        step="0.01"
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                            </div>

                            {itemForm.type === 'PART' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Part Number</label>
                                        <input
                                            type="text"
                                            value={itemForm.partNumber}
                                            onChange={(e) => setItemForm({ ...itemForm, partNumber: e.target.value })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                            placeholder="Enter part number..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Part Source</label>
                                        <select
                                            value={itemForm.partSource}
                                            onChange={(e) => setItemForm({ ...itemForm, partSource: e.target.value as PartSource })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                        >
                                            <option value="STOCK">Stock</option>
                                            <option value="ORDERED">Ordered</option>
                                            <option value="CUSTOMER_SUPPLIED">Customer Supplied</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {itemForm.type === 'LABOR' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Labor Hours</label>
                                        <input
                                            type="number"
                                            value={itemForm.laborHours}
                                            onChange={(e) => setItemForm({ ...itemForm, laborHours: Number(e.target.value) })}
                                            min="0"
                                            step="0.5"
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Technician Name</label>
                                        <input
                                            type="text"
                                            value={itemForm.technicianName}
                                            onChange={(e) => setItemForm({ ...itemForm, technicianName: e.target.value })}
                                            className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                            placeholder="Enter technician name..."
                                        />
                                    </div>
                                </>
                            )}

                            <div className="rounded-lg bg-blue-500/10 border border-blue-200 p-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-blue-300">Line Total:</span>
                                    <span className="text-xl font-bold text-blue-300">
                                        {formatCurrency(itemForm.quantity * itemForm.unitPrice)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/10 flex justify-end gap-3 sticky bottom-0 bg-slate-900">
                            <button
                                onClick={() => {
                                    setShowAddItemModal(false);
                                    setEditingItemIndex(null);
                                    resetItemForm();
                                }}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddItem}
                                disabled={!itemForm.description || itemForm.quantity <= 0 || itemForm.unitPrice < 0}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                            >
                                {editingItemIndex !== null ? 'Update' : 'Add'} Item
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
