'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Printer,
  Check,
  Send,
  FileText,
  Download,
  X,
  CheckCircle,
} from 'lucide-react';

interface Vehicle {
  vehicleType: 'SEDAN' | 'SUV' | 'VAN' | 'BUS' | 'TRUCK' | 'LUXURY';
  make: string;
  model: string;
  year: number;
  quantity: number;
  monthlyRate: number;
}

interface CostBreakdown {
  baseMonthlyRate: number;
  interestRate: number;
  interestAmount: number;
  markupRate: number;
  markupAmount: number;
  accessoriesCost: number;
  servicesCost: number;
  insuranceCost: number;
  insuranceIncluded: boolean;
  maintenanceCost: number;
  maintenanceIncluded: boolean;
  driverCost: number;
  driverIncluded: boolean;
  securityDeposit: number;
  totalMonthlyRate: number;
}

interface ApprovalStep {
  id: string;
  stepName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approverName: string;
  approverEmail: string;
  comment: string;
  timestamp: string;
}

interface LeaseQuotation {
  id: string;
  quotationNumber: string;
  lesseeId: string;
  lesseeName: string;
  leaseType: 'LONG_TERM' | 'SHORT_TERM' | 'DAILY' | 'MONTHLY';
  duration: number;
  startDate: string;
  endDate: string;
  currency: 'AED' | 'USD' | 'EUR' | 'SAR';
  status:
    | 'NEW'
    | 'INTERNAL_APPROVAL'
    | 'SENT_TO_CUSTOMER'
    | 'CUSTOMER_APPROVED'
    | 'CREDIT_APPROVAL'
    | 'PO_PREPARED'
    | 'DELIVERY_IN_PROGRESS'
    | 'DELIVERED'
    | 'REJECTED'
    | 'CANCELLED';
  validUntil: string;
  vehicles: Vehicle[];
  costs: CostBreakdown;
  totalMonthlyRate: number;
  totalValue: number;
  mileageCap: number;
  insuranceIncluded: boolean;
  maintenanceIncluded: boolean;
  driverIncluded: boolean;
  notes: string;
  createdAt: string;
}

const STATUS_PIPELINE = [
  'NEW',
  'INTERNAL_APPROVAL',
  'SENT_TO_CUSTOMER',
  'CUSTOMER_APPROVED',
  'CREDIT_APPROVAL',
  'PO_PREPARED',
  'DELIVERY_IN_PROGRESS',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
];

export default function QuotationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quotationId = params?.id as string;

  const [quotation, setQuotation] = useState<LeaseQuotation | null>(null);
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approverName, setApproverName] = useState('');
  const [approverComment, setApproverComment] = useState('');

  // Mock data
  const mockQuotation: LeaseQuotation = {
    id: '1',
    quotationNumber: 'QT-001',
    lesseeId: 'LESS-001',
    lesseeName: 'Al Mansouri Trading',
    leaseType: 'LONG_TERM',
    duration: 36,
    startDate: '2024-05-01',
    endDate: '2027-05-01',
    currency: 'AED',
    status: 'NEW',
    validUntil: '2024-05-15',
    vehicles: [
      {
        vehicleType: 'SUV',
        make: 'Toyota',
        model: 'Land Cruiser',
        year: 2024,
        quantity: 5,
        monthlyRate: 4500,
      },
    ],
    costs: {
      baseMonthlyRate: 22500,
      interestRate: 5,
      interestAmount: 1125,
      markupRate: 3,
      markupAmount: 675,
      accessoriesCost: 500,
      servicesCost: 800,
      insuranceCost: 2000,
      insuranceIncluded: true,
      maintenanceCost: 1500,
      maintenanceIncluded: true,
      driverCost: 0,
      driverIncluded: false,
      securityDeposit: 50000,
      totalMonthlyRate: 29200,
    },
    totalMonthlyRate: 29200,
    totalValue: 1051200,
    mileageCap: 100000,
    insuranceIncluded: true,
    maintenanceIncluded: true,
    driverIncluded: false,
    notes: 'VIP customer, white glove service',
    createdAt: '2024-04-12',
  };

  const mockApprovalSteps: ApprovalStep[] = [
    {
      id: '1',
      stepName: 'Manager Review',
      status: 'PENDING',
      approverName: 'Ahmed Khalil',
      approverEmail: 'ahmed.khalil@company.com',
      comment: 'Awaiting manager approval',
      timestamp: '2024-04-12T10:00:00Z',
    },
    {
      id: '2',
      stepName: 'Finance Review',
      status: 'PENDING',
      approverName: 'Fatima Al Mansoori',
      approverEmail: 'fatima@company.com',
      comment: 'Pending finance review',
      timestamp: '2024-04-13T00:00:00Z',
    },
    {
      id: '3',
      stepName: 'Director Approval',
      status: 'PENDING',
      approverName: 'Mohammed Hassan',
      approverEmail: 'mohammed@company.com',
      comment: 'Awaiting director sign-off',
      timestamp: '2024-04-13T00:00:00Z',
    },
  ];

  useEffect(() => {
    // In production, fetch from /api/leasing/quotations/[id]
    setQuotation(mockQuotation);
    setApprovalSteps(mockApprovalSteps);
    setLoading(false);
  }, [quotationId]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      INTERNAL_APPROVAL: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      SENT_TO_CUSTOMER: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      CUSTOMER_APPROVED: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      CREDIT_APPROVAL: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      PO_PREPARED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      DELIVERY_IN_PROGRESS: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      DELIVERED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
      CANCELLED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    return colors[status] || colors.NEW;
  };

  const isStepCompleted = (step: string) => {
    const currentIndex = STATUS_PIPELINE.indexOf(
      quotation?.status as string
    );
    const stepIndex = STATUS_PIPELINE.indexOf(step);
    return stepIndex < currentIndex;
  };

  const isStepCurrent = (step: string) => {
    return quotation?.status === step;
  };

  const handleApproveInternally = async (e: React.FormEvent) => {
    e.preventDefault();
    // In production, POST to /api/leasing/quotations/[id]/approve
    if (quotation) {
      setQuotation({
        ...quotation,
        status: 'INTERNAL_APPROVAL',
      });
    }
    setShowApproveModal(false);
    setApproverName('');
    setApproverComment('');
  };

  const handleSendToCustomer = () => {
    if (quotation) {
      setQuotation({
        ...quotation,
        status: 'SENT_TO_CUSTOMER',
      });
    }
  };

  const handleConvertToContract = () => {
    // In production, POST to /api/leasing/quotations/[id]/convert
    router.push(`/leasing/contracts-v2/${quotation?.id}`);
  };

  if (loading || !quotation) {
    return (
      <div className="min-h-screen bg-slate-900 p-8 flex items-center justify-center">
        <div className="text-slate-400">Loading quotation...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-8 print:bg-white" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-7xl">
        {/* Top Bar */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="text-slate-400 hover:text-white print:hidden"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-white print:text-black">
                {quotation.quotationNumber}
              </h1>
              <p className="text-slate-400 print:text-gray-600 text-sm">
                Quotation dated {quotation.createdAt}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                quotation.status
              )}`}
            >
              {quotation.status.replace(/_/g, ' ')}
            </span>
            <a
              href={`/api/leasing/quotations/${quotation.id}/pdf?lang=en&download=1`}
              className="rounded-xl bg-emerald-700/80 border border-emerald-500/30 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 flex items-center gap-2"
              title="Download bilingual PDF (English layout)"
            >
              <Download className="h-4 w-4" />
              PDF (EN)
            </a>
            <a
              href={`/api/leasing/quotations/${quotation.id}/pdf?lang=ar&download=1`}
              className="rounded-xl bg-emerald-700/80 border border-emerald-500/30 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 flex items-center gap-2"
              title="Download bilingual PDF (Arabic layout)"
            >
              <Download className="h-4 w-4" />
              PDF (AR)
            </a>
            <button
              onClick={() => window.print()}
              className="rounded-xl bg-slate-700 border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600 flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 print:grid-cols-2">
          {/* Left Column */}
          <div className="col-span-2 space-y-6">
            {/* Quotation Header Card */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-white print:text-black mb-4">
                Quotation Details
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Quotation Number
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.quotationNumber}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Issued Date
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.createdAt}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Valid Until
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.validUntil}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Lessee Name
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.lesseeName}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Lease Type
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.leaseType}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Duration
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.duration} months
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600">
                    Currency
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.currency}
                  </p>
                </div>
              </div>
            </div>

            {/* Vehicle Summary Table */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden print:border-gray-300 print:bg-white">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-white print:text-black mb-4">
                  Vehicle Summary
                </h2>
              </div>
              <table className="w-full">
                <thead className="bg-slate-800/50 print:bg-gray-100">
                  <tr className="border-b border-white/5 print:border-gray-300">
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Make
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Model
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Year
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Qty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 print:text-black">
                      Monthly Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quotation.vehicles.map((vehicle, index) => (
                    <tr
                      key={index}
                      className="border-b border-white/5 hover:bg-white/5 print:border-gray-300"
                    >
                      <td className="px-6 py-4 text-sm text-white print:text-black">
                        {vehicle.vehicleType}
                      </td>
                      <td className="px-6 py-4 text-sm text-white print:text-black">
                        {vehicle.make}
                      </td>
                      <td className="px-6 py-4 text-sm text-white print:text-black">
                        {vehicle.model}
                      </td>
                      <td className="px-6 py-4 text-sm text-white print:text-black">
                        {vehicle.year}
                      </td>
                      <td className="px-6 py-4 text-sm text-white print:text-black">
                        {vehicle.quantity}
                      </td>
                      <td className="px-6 py-4 text-sm text-white print:text-black font-medium">
                        {(
                          vehicle.monthlyRate * vehicle.quantity
                        ).toLocaleString('en-AE')}{' '}
                        {quotation.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cost Breakdown Card */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-white print:text-black mb-4">
                Cost Breakdown
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400 print:text-gray-600">
                    Base Monthly Rate
                  </span>
                  <span className="text-white print:text-black font-medium">
                    {quotation.costs.baseMonthlyRate.toLocaleString('en-AE')}{' '}
                    {quotation.currency}
                  </span>
                </div>
                {quotation.costs.interestAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Interest ({quotation.costs.interestRate}%)
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.interestAmount.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.markupAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Markup ({quotation.costs.markupRate}%)
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.markupAmount.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.accessoriesCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Accessories
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.accessoriesCost.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.servicesCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Services
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.servicesCost.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.insuranceIncluded && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Insurance
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.insuranceCost.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.maintenanceIncluded && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Maintenance
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.maintenanceCost.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                {quotation.costs.driverIncluded && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 print:text-gray-600">
                      Driver
                    </span>
                    <span className="text-white print:text-black">
                      {quotation.costs.driverCost.toLocaleString('en-AE')}{' '}
                      {quotation.currency}
                    </span>
                  </div>
                )}
                <div className="border-t border-white/10 print:border-gray-300 pt-3 mt-3 flex justify-between font-semibold">
                  <span className="text-white print:text-black">
                    Total Monthly Rate
                  </span>
                  <span className="text-emerald-400 print:text-green-600 text-lg">
                    {quotation.totalMonthlyRate.toLocaleString('en-AE')}{' '}
                    {quotation.currency}
                  </span>
                </div>
                <div className="bg-blue-600/10 print:bg-blue-50 border border-blue-500/30 print:border-blue-300 rounded-lg p-3 flex justify-between items-center">
                  <span className="text-white print:text-black font-semibold">
                    Total Contract Value
                  </span>
                  <span className="text-blue-400 print:text-blue-600 text-2xl font-bold">
                    {quotation.totalValue.toLocaleString('en-AE')}{' '}
                    {quotation.currency}
                  </span>
                </div>
              </div>
            </div>

            {/* Contract Terms Card */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 print:border-gray-300 print:bg-white">
              <h2 className="text-lg font-semibold text-white print:text-black mb-4">
                Contract Terms
              </h2>
              <div className="space-y-4">
                <div>
                  <p className="text-slate-400 print:text-gray-600 text-sm mb-1">
                    Mileage Cap
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.mileageCap.toLocaleString('en-AE')} km
                  </p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-slate-400 print:text-gray-600 text-sm mb-2">
                      Insurance Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 print:bg-green-100 print:text-green-700 print:border-green-300">
                      {quotation.insuranceIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-400 print:text-gray-600 text-sm mb-2">
                      Maintenance Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 print:bg-green-100 print:text-green-700 print:border-green-300">
                      {quotation.maintenanceIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-400 print:text-gray-600 text-sm mb-2">
                      Driver Included
                    </p>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 print:bg-red-100 print:text-red-700 print:border-red-300">
                      {quotation.driverIncluded ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-slate-400 print:text-gray-600 text-sm mb-1">
                    Security Deposit
                  </p>
                  <p className="text-white print:text-black font-medium">
                    {quotation.costs.securityDeposit.toLocaleString('en-AE')}{' '}
                    {quotation.currency}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6 print:hidden">
            {/* Status Timeline */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Status Timeline
              </h2>
              <div className="space-y-4">
                {STATUS_PIPELINE.map((status, index) => {
                  const isCompleted = isStepCompleted(status);
                  const isCurrent = isStepCurrent(status);

                  return (
                    <div key={status} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center font-medium text-sm ${
                            isCompleted
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : isCurrent
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle className="h-5 w-5" />
                          ) : (
                            index + 1
                          )}
                        </div>
                        {index < STATUS_PIPELINE.length - 1 && (
                          <div
                            className={`w-0.5 h-8 mt-2 ${
                              isCompleted
                                ? 'bg-emerald-500/30'
                                : 'bg-slate-700/50'
                            }`}
                          />
                        )}
                      </div>
                      <div className="flex-1 pt-1">
                        <p
                          className={`text-sm font-medium ${
                            isCompleted || isCurrent
                              ? 'text-white'
                              : 'text-slate-400'
                          }`}
                        >
                          {status.replace(/_/g, ' ')}
                        </p>
                        {isCompleted && (
                          <p className="text-xs text-emerald-400 mt-1">
                            Completed
                          </p>
                        )}
                        {isCurrent && (
                          <p className="text-xs text-blue-400 mt-1">Current</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Approval Steps */}
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Approval Steps
              </h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {approvalSteps.map((step) => (
                  <div
                    key={step.id}
                    className="bg-slate-700/30 border border-white/5 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-white">
                        {step.stepName}
                      </p>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          step.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : step.status === 'REJECTED'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-1">
                      {step.approverName}
                    </p>
                    <p className="text-xs text-slate-500">{step.comment}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            {quotation.status === 'NEW' && (
              <button
                onClick={() => setShowApproveModal(true)}
                className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center justify-center gap-2"
              >
                <Check className="h-4 w-4" />
                Approve Internally
              </button>
            )}
            {quotation.status === 'INTERNAL_APPROVAL' && (
              <button
                onClick={handleSendToCustomer}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center justify-center gap-2"
              >
                <Send className="h-4 w-4" />
                Send to Customer
              </button>
            )}
            {(quotation.status === 'CUSTOMER_APPROVED' ||
              quotation.status === 'CREDIT_APPROVAL') && (
              <button
                onClick={handleConvertToContract}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center justify-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Convert to Contract
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Approve Internally</h2>
              <button
                onClick={() => setShowApproveModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleApproveInternally} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Approver Name *
                </label>
                <input
                  type="text"
                  required
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Comments
                </label>
                <textarea
                  value={approverComment}
                  onChange={(e) => setApproverComment(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Add your comments..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setShowApproveModal(false)}
                  className="flex-1 rounded-xl bg-slate-700 border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background: white;
            color: black;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:text-black {
            color: black !important;
          }
          .print\\:text-gray-600 {
            color: #4b5563 !important;
          }
          .print\\:border-gray-300 {
            border-color: #d1d5db !important;
          }
          .print\\:bg-white {
            background-color: white !important;
          }
          .print\\:bg-gray-100 {
            background-color: #f3f4f6 !important;
          }
          .print\\:grid-cols-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .print\\:bg-blue-50 {
            background-color: #eff6ff !important;
          }
          .print\\:bg-blue-100 {
            background-color: #dbeafe !important;
          }
          .print\\:text-blue-600 {
            color: #2563eb !important;
          }
          .print\\:border-blue-300 {
            border-color: #93c5fd !important;
          }
          .print\\:bg-green-100 {
            background-color: #dcfce7 !important;
          }
          .print\\:text-green-700 {
            color: #15803d !important;
          }
          .print\\:border-green-300 {
            border-color: #86efac !important;
          }
          .print\\:bg-red-100 {
            background-color: #fee2e2 !important;
          }
          .print\\:text-red-700 {
            color: #b91c1c !important;
          }
          .print\\:border-red-300 {
            border-color: #fca5a5 !important;
          }
        }
      `}</style>
    </div>
  );
}
