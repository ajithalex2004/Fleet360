'use client';
import { VEHICLE_GROUPS, VEHICLE_MAKES, getModelsForMake, getGroupsForModel } from '@/lib/vehicleMaster';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Plus,
  Eye,
  ArrowRight,
  Search,
  Filter,
  X,
} from 'lucide-react';

interface LeaseInquiry {
  id: string;
  inquiryNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName?: string;
  vehicleType: string;
  vehicleGroups?: string[];
  vehicleMakes?: string[];
  vehicleModels?: string[];
  vehicleCount?: number;
  count?: number;
  leaseType: 'LONG_TERM' | 'SHORT_TERM' | 'DAILY' | 'MONTHLY';
  durationMonths?: number;
  duration?: number;
  startDate: string;
  status: 'NEW' | 'CONTACTED' | 'QUOTATION_SENT' | 'CONVERTED' | 'LOST';
  assignedTo: string;
  requiresDriver: boolean;
  requiresInsurance: boolean;
  requiresMaintenance: boolean;
  notes: string;
  createdAt: string;
}

export default function LeaseInquiriesPage() {
  const router = useRouter();
  const [inquiries, setInquiries] = useState<LeaseInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<LeaseInquiry | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [editStatus, setEditStatus] = useState<string>('');
  const [editNotes, setEditNotes] = useState('');
  const [editAssignedTo, setEditAssignedTo] = useState('');

  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    companyName: '',
    vehicleType: 'SEDAN',
    vehicleGroups: [] as string[],
    vehicleMakes: [] as string[],
    vehicleModels: [] as string[],
    vehicleCount: 1,
    leaseType: 'LONG_TERM',
    durationMonths: 12,
    startDate: '',
    requiresDriver: false,
    requiresInsurance: false,
    requiresMaintenance: false,
    notes: '',
    assignedTo: '',
  });

  // Mock data
  const mockInquiries: LeaseInquiry[] = [
    {
      id: '1',
      inquiryNumber: 'INQ-001',
      customerName: 'Ahmed Al Mansouri',
      customerEmail: 'ahmed@example.com',
      customerPhone: '+971501234567',
      companyName: 'Al Mansouri Trading',
      vehicleType: 'SUV',
      vehicleCount: 5,
      leaseType: 'LONG_TERM',
      durationMonths: 36,
      startDate: '2024-05-01',
      status: 'NEW',
      assignedTo: 'Fatima Khan',
      requiresDriver: true,
      requiresInsurance: true,
      requiresMaintenance: true,
      notes: 'VIP customer, requires white glove service',
      createdAt: '2024-04-12',
    },
    {
      id: '2',
      inquiryNumber: 'INQ-002',
      customerName: 'Aisha Al Qadi',
      customerEmail: 'aisha@example.com',
      customerPhone: '+971501234568',
      companyName: 'Tech Solutions LLC',
      vehicleType: 'SEDAN',
    vehicleGroups: [] as string[],
    vehicleMakes: [] as string[],
    vehicleModels: [] as string[],
      vehicleCount: 10,
      leaseType: 'LONG_TERM',
      durationMonths: 24,
      startDate: '2024-05-15',
      status: 'CONTACTED',
      assignedTo: 'Mohammed Hassan',
      requiresDriver: false,
      requiresInsurance: true,
      requiresMaintenance: false,
      notes: 'Fleet for employee transportation',
      createdAt: '2024-04-10',
    },
    {
      id: '3',
      inquiryNumber: 'INQ-003',
      customerName: 'Ibrahim Al Fahdi',
      customerEmail: 'ibrahim@example.com',
      customerPhone: '+971501234569',
      companyName: 'Construction Co',
      vehicleType: 'TRUCK',
      vehicleCount: 3,
      leaseType: 'SHORT_TERM',
      durationMonths: 6,
      startDate: '2024-05-20',
      status: 'QUOTATION_SENT',
      assignedTo: 'Layla Omar',
      requiresDriver: true,
      requiresInsurance: true,
      requiresMaintenance: true,
      notes: 'Project-based lease',
      createdAt: '2024-04-08',
    },
    {
      id: '4',
      inquiryNumber: 'INQ-004',
      customerName: 'Fatima Al Zahra',
      customerEmail: 'fatima@example.com',
      customerPhone: '+971501234570',
      companyName: 'Hospitality Group',
      vehicleType: 'SEDAN',
    vehicleGroups: [] as string[],
    vehicleMakes: [] as string[],
    vehicleModels: [] as string[],
      vehicleCount: 15,
      leaseType: 'LONG_TERM',
      durationMonths: 48,
      startDate: '2024-04-01',
      status: 'CONVERTED',
      assignedTo: 'Ahmed Khalil',
      requiresDriver: true,
      requiresInsurance: true,
      requiresMaintenance: true,
      notes: 'Corporate accounts preferred',
      createdAt: '2024-03-20',
    },
  ];

  useEffect(() => {
    fetch('/api/leasing/inquiries')
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data) => setInquiries(data))
      .catch(() => setInquiries(mockInquiries as unknown as LeaseInquiry[]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredInquiries = inquiries.filter((inquiry) => {
    const statusMatch =
      statusFilter === 'All' || inquiry.status === statusFilter;
    const vehicleMatch =
      vehicleTypeFilter === 'All' || inquiry.vehicleType === vehicleTypeFilter;
    const searchMatch =
      (inquiry.customerName ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inquiry.companyName ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inquiry.customerEmail ?? '').toLowerCase().includes(searchTerm.toLowerCase());

    return statusMatch && vehicleMatch && searchMatch;
  });

  const stats = [
    {
      label: 'New',
      value: inquiries.filter((i) => i.status === 'NEW').length,
      color: 'blue',
    },
    {
      label: 'Contacted',
      value: inquiries.filter((i) => i.status === 'CONTACTED').length,
      color: 'amber',
    },
    {
      label: 'Quotation Sent',
      value: inquiries.filter((i) => i.status === 'QUOTATION_SENT').length,
      color: 'purple',
    },
    {
      label: 'Converted',
      value: inquiries.filter((i) => i.status === 'CONVERTED').length,
      color: 'emerald',
    },
  ];

  const getStatusColor = (
    status: 'NEW' | 'CONTACTED' | 'QUOTATION_SENT' | 'CONVERTED' | 'LOST'
  ) => {
    const colors = {
      NEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      CONTACTED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      QUOTATION_SENT: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      CONVERTED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      LOST: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    return colors[status];
  };

  const openDetail = (inquiry: LeaseInquiry) => {
    setSelectedInquiry(inquiry);
    setEditStatus(inquiry.status);
    setEditNotes(inquiry.notes ?? '');
    setEditAssignedTo(inquiry.assignedTo ?? '');
    setShowDetailModal(true);
  };

  const updateInquiry = async () => {
    if (!selectedInquiry) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/leasing/inquiries/${selectedInquiry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:     editStatus,
          notes:      editNotes     || null,
          assignedTo: editAssignedTo || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      setInquiries(prev =>
        prev.map(i => i.id === selectedInquiry.id
          ? { ...i, status: editStatus as any, notes: editNotes, assignedTo: editAssignedTo }
          : i
        )
      );
      setShowDetailModal(false);
    } catch (e: any) {
      alert('Update failed: ' + (e.message ?? 'Unknown error'));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/leasing/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: formData.customerName,
          customerEmail: formData.customerEmail,
          customerPhone: formData.customerPhone,
          companyName: formData.companyName,
          vehicleType: formData.vehicleType,
          vehicleGroups: formData.vehicleGroups?.length ? JSON.stringify(formData.vehicleGroups) : null,
          vehicleMakes:  formData.vehicleMakes?.length  ? JSON.stringify(formData.vehicleMakes)  : null,
          vehicleModels: formData.vehicleModels?.length ? JSON.stringify(formData.vehicleModels) : null,
          vehicleCount: formData.vehicleCount,
          leaseType: formData.leaseType,
          durationMonths: formData.durationMonths,
          requiresDriver: formData.requiresDriver,
          requiresInsurance: formData.requiresInsurance,
          requiresMaintenance: formData.requiresMaintenance,
          notes: formData.notes,
          inquiryNumber: `INQ-${Date.now().toString().slice(-6)}`,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setInquiries([saved, ...inquiries]);
        setShowNewModal(false);
        return;
      }
    } catch {
      // fall through to local state
    }
    // Fallback: optimistic update
    const newInquiry = {
      id: String(inquiries.length + 1),
      inquiryNumber: `INQ-${String(inquiries.length + 1).padStart(3, '0')}`,
      ...formData,
      status: 'NEW',
      createdAt: new Date().toISOString().split('T')[0],
    };
    setInquiries([newInquiry as unknown as LeaseInquiry, ...inquiries]);
    setShowNewModal(false);
    setFormData({
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      companyName: '',
      vehicleType: 'SEDAN',
    vehicleGroups: [] as string[],
    vehicleMakes: [] as string[],
    vehicleModels: [] as string[],
      vehicleCount: 1,
      leaseType: 'LONG_TERM',
      durationMonths: 12,
      startDate: '',
      requiresDriver: false,
      requiresInsurance: false,
      requiresMaintenance: false,
      notes: '',
      assignedTo: '',
    });
  };

  const handleConvertToQuotation = (inquiryId: string) => {
    // Clear cached inquiry ID so re-convert always triggers
    try { window.sessionStorage.removeItem('xl_last_inquiry_id'); } catch {}
    router.push(`/leasing/quotations?fromInquiry=${inquiryId}`);
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white">Lease Inquiries</h1>
            <p className="mt-2 text-slate-400">
              Capture and track initial customer interest
            </p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Inquiry
          </button>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-800/50 border border-white/10 rounded-2xl p-6"
            >
              <p className="text-slate-400 text-sm mb-2">{stat.label}</p>
              <p className="text-4xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-6 bg-slate-800/50 border border-white/10 rounded-2xl p-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option>All</option>
                <option>NEW</option>
                <option>CONTACTED</option>
                <option>QUOTATION_SENT</option>
                <option>CONVERTED</option>
                <option>LOST</option>
              </select>
            </div>

            {/* Vehicle Type Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Vehicle Type
              </label>
              <select
                value={vehicleTypeFilter}
                onChange={(e) => setVehicleTypeFilter(e.target.value)}
                className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option>All</option>
                <option>SEDAN</option>
                <option>SUV</option>
                <option>VAN</option>
                <option>BUS</option>
                <option>TRUCK</option>
                <option>LUXURY</option>
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Customer name or company..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl pl-10 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-slate-800/50">
              <tr className="border-b border-white/5">
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Inquiry #
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Customer Name
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Company
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Vehicle Type
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Count
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Lease Type
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Duration
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Start Date
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 whitespace-nowrap">
                  Assigned To
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-white whitespace-nowrap bg-blue-900/30">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredInquiries.map((inquiry) => (
                <tr
                  key={inquiry.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="px-3 py-3 text-sm text-white font-medium">
                    {inquiry.inquiryNumber}
                  </td>
                  <td className="px-3 py-3 text-sm text-white">
                    {inquiry.customerName}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-200">
                    {inquiry.companyName}
                  </td>
                  <td className="px-3 py-3 text-sm text-white">
                    {inquiry.vehicleType}
                  </td>
                  <td className="px-3 py-3 text-sm text-white">
                    {inquiry.vehicleCount ?? "-"}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-200">
                    {inquiry.leaseType}
                  </td>
                  <td className="px-3 py-3 text-sm text-white">
                    {(inquiry as any).durationMonths ?? inquiry.durationMonths ? `${(inquiry as any).durationMonths ?? inquiry.durationMonths} months` : "-"}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-200">
                    {inquiry.startDate ? new Date(inquiry.startDate).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <button
                      onClick={() => openDetail(inquiry)}
                      className={`px-2 py-1 rounded-full text-xs font-medium border hover:opacity-80 transition-opacity ${getStatusColor(
                        inquiry.status
                      )}`}
                    >
                      {inquiry.status}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-200">
                    {inquiry.assignedTo ?? "-"}
                  </td>
                  <td className="px-3 py-3 text-sm whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openDetail(inquiry)}
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 text-xs font-medium flex items-center gap-1 transition-all">
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                      <button
                        onClick={() => handleConvertToQuotation(inquiry.id)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 text-xs font-medium flex items-center gap-1 transition-all"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Convert
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Inquiry Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Inquiry</h2>
              <button
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.customerName}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerName: e.target.value,
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="Enter customer name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Customer Email
                  </label>
                  <input
                    type="email"
                    value={formData.customerEmail}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerEmail: e.target.value,
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="email@example.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Customer Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.customerPhone}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerPhone: e.target.value,
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="+971 50 123 4567"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) =>
                      setFormData({ ...formData, companyName: e.target.value })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="Company name"
                  />
                </div>
              </div>

              {/* Vehicle Group Multi-select */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle Group <span className="text-xs text-slate-500">(multi-select)</span></label>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_GROUPS.map(g => {
                    const selected = (formData.vehicleGroups ?? []).includes(g.code);
                    return (
                      <button type="button" key={g.code}
                        onClick={() => {
                          const groups = formData.vehicleGroups ?? [];
                          setFormData({ ...formData, vehicleGroups: selected ? groups.filter(x => x !== g.code) : [...groups, g.code] });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${selected ? 'bg-blue-500/30 text-blue-300 border-blue-500/50' : 'bg-slate-700 text-slate-400 border-white/10 hover:border-white/20'}`}>
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle Type <span className="text-xs text-slate-500">(primary)</span></label>
                  <select
                    value={formData.vehicleType}
                    onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="SEDAN">Sedan</option>
                    <option value="SUV">SUV</option>
                    <option value="VAN">Van</option>
                    <option value="BUS">Bus</option>
                    <option value="MINIBUS">Minibus</option>
                    <option value="TRUCK">Truck</option>
                    <option value="PICKUP">Pickup</option>
                    <option value="LUXURY">Luxury</option>
                    <option value="EXECUTIVE_SEDAN">Executive Sedan</option>
                    <option value="LIMOUSINE">Limousine</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Vehicle Count *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.vehicleCount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        vehicleCount: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Make & Model Multi-select */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Make <span className="text-xs text-slate-500">(multi-select)</span></label>
                  <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-700/50 border border-white/10 min-h-[42px] max-h-32 overflow-y-auto">
                    {VEHICLE_MAKES.map(m => {
                      const selected = (formData.vehicleMakes ?? []).includes(m.make);
                      return (
                        <button type="button" key={m.make}
                          onClick={() => {
                            const makes = formData.vehicleMakes ?? [];
                            const newMakes = selected ? makes.filter(x => x !== m.make) : [...makes, m.make];
                            setFormData({ ...formData, vehicleMakes: newMakes, vehicleModels: (formData.vehicleModels ?? []).filter(mo => newMakes.some(mk => VEHICLE_MAKES.find(vm => vm.make === mk)?.models.some(md => md.model === mo))) });
                          }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-all ${selected ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}>
                          {m.make}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Model <span className="text-xs text-slate-500">(multi-select - select make first)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-700/50 border border-white/10 min-h-[42px] max-h-32 overflow-y-auto">
                    {(formData.vehicleMakes ?? []).length === 0
                      ? <span className="text-xs text-slate-500 p-1">Select a make first</span>
                      : (formData.vehicleMakes ?? []).flatMap(mk => getModelsForMake(mk)).map(({ model, groups }) => {
                          const selected = (formData.vehicleModels ?? []).includes(model);
                          const autoGroups = groups;
                          return (
                            <button type="button" key={model}
                              onClick={() => {
                                const models = formData.vehicleModels ?? [];
                                const newModels = selected ? models.filter(x => x !== model) : [...models, model];
                                // Auto-add detected groups
                                if (!selected && autoGroups.length) {
                                  const currentGroups = formData.vehicleGroups ?? [];
                                  const newGroups = [...new Set([...currentGroups, ...autoGroups])];
                                  setFormData({ ...formData, vehicleModels: newModels, vehicleGroups: newGroups });
                                  return;
                                }
                                setFormData({ ...formData, vehicleModels: newModels });
                              }}
                              title={`Belongs to: ${groups.join(', ')}`}
                              className={`px-2 py-1 rounded text-xs font-medium transition-all ${selected ? 'bg-violet-500/30 text-violet-300 border border-violet-500/40' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}>
                              {model}
                            </button>
                          );
                        })
                    }
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Lease Type *
                  </label>
                  <select
                    value={formData.leaseType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        leaseType: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="LONG_TERM">LONG_TERM</option>
                    <option value="SHORT_TERM">SHORT_TERM</option>
                    <option value="DAILY">DAILY</option>
                    <option value="MONTHLY">MONTHLY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Duration (months) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.durationMonths}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        durationMonths: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Start Date *
                </label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={(e) =>
                    setFormData({ ...formData, startDate: e.target.value })
                  }
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresDriver}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        requiresDriver: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-white/10"
                  />
                  <span className="text-sm text-slate-300">
                    Requires Driver
                  </span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresInsurance}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        requiresInsurance: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-white/10"
                  />
                  <span className="text-sm text-slate-300">
                    Requires Insurance
                  </span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresMaintenance}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        requiresMaintenance: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-white/10"
                  />
                  <span className="text-sm text-slate-300">
                    Requires Maintenance
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Additional notes..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Assigned To
                </label>
                <input
                  type="text"
                  value={formData.assignedTo}
                  onChange={(e) =>
                    setFormData({ ...formData, assignedTo: e.target.value })
                  }
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Team member name"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Create Inquiry
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 rounded-xl bg-slate-700 border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* -- View & Edit Inquiry Modal --------------------------- */}
      {showDetailModal && selectedInquiry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {selectedInquiry.inquiryNumber ?? 'Inquiry'}
                </h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {selectedInquiry.customerName}
                  {selectedInquiry.companyName ? ` - ${selectedInquiry.companyName}` : ''}
                </p>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="text-slate-400 hover:text-white text-xl">X</button>
            </div>

            {/* Inquiry details */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              {[
                ['Customer',     selectedInquiry.customerName],
                ['Company',      selectedInquiry.companyName ?? '-'],
                ['Email',        selectedInquiry.customerEmail ?? '-'],
                ['Phone',        selectedInquiry.customerPhone ?? '-'],
                ['Vehicle Type', selectedInquiry.vehicleType ?? '-'],
                ['Count',        String(selectedInquiry.count ?? 1)],
                ['Lease Type',   selectedInquiry.leaseType ?? '-'],
                ['Duration',     selectedInquiry.duration ? `${selectedInquiry.duration} months` : '-'],
                ['Start Date',   selectedInquiry.startDate ?? '-'],
                ['Driver',       selectedInquiry.requiresDriver ? 'Required' : 'Not required'],
                ['Insurance',    selectedInquiry.requiresInsurance ? 'Required' : 'Not required'],
                ['Maintenance',  selectedInquiry.requiresMaintenance ? 'Required' : 'Not required'],
              ].map(([label, value]) => (
                <div key={label} className="bg-slate-700/40 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-0.5">{label}</div>
                  <div className="text-white font-medium">{value}</div>
                </div>
              ))}
            </div>

            {/* Editable fields */}
            <div className="space-y-4 border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Update Inquiry</h3>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                >
                  {['NEW','CONTACTED','QUOTATION_SENT','CONVERTED','LOST'].map(s => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Assigned To</label>
                <input
                  type="text"
                  value={editAssignedTo}
                  onChange={e => setEditAssignedTo(e.target.value)}
                  placeholder="Agent name or ID"
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={3}
                  placeholder="Add internal notes..."
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  try { window.sessionStorage.removeItem('xl_last_inquiry_id'); } catch {}
                  router.push(`/leasing/quotations?fromInquiry=${selectedInquiry.id}`);
                  setShowDetailModal(false);
                }}
                className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90 text-sm flex items-center gap-1"
              >
                Convert to Quotation
              </button>
              <button
                onClick={updateInquiry}
                disabled={updatingStatus}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 disabled:opacity-50"
              >
                {updatingStatus ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
