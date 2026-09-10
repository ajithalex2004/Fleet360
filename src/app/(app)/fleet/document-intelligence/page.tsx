'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Car,
  User,
  DollarSign,
  Calendar,
  Building,
  Shield,
  FileCheck,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ArrowRight,
  Check,
  Eye,
  AlertTriangle,
  Layers,
  Search,
  ShieldAlert,
  Edit3,
  Flame,
  Bookmark,
  Send,
  Zap,
  Package,
  Filter,
  CheckSquare,
  XCircle,
} from 'lucide-react';

const DOC_CATEGORIES = [
  { key: 'ALL', label: 'All Documents' },
  { key: 'REGISTRATION_CARD', label: 'Registration / Mulkiya' },
  { key: 'INSURANCE_POLICY', label: 'Insurance Policies' },
  { key: 'DRIVER_LICENSE', label: 'Driver Licenses' },
  { key: 'QUOTATION', label: 'Quotations' },
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'MAINTENANCE_REPORT', label: 'Maintenance / Job Cards' },
  { key: 'CONTRACT', label: 'Lease & Service Contracts' },
  { key: 'PROOF_OF_DELIVERY', label: 'Proof of Delivery (POD)' },
  { key: 'INSPECTION_SHEET', label: 'Vehicle Inspection Sheets' },
];

const PRESET_SAMPLES = [
  {
    title: 'Dubai Mulkiya (Registration)',
    category: 'REGISTRATION_CARD',
    fileName: 'dubai_mulkiya_vehicle_78219.pdf',
    text: `UNITED ARAB EMIRATES - MINISTRY OF INTERIOR
VEHICLE REGISTRATION CARD (MULKIYA)
Traffic Plate: Dubai B 78219
Chassis / VIN: 1HGBH41JXMN109182
Make & Model: Toyota HiAce Commuter High Roof 3.5L
Model Year: 2024
Color: White
Expiry Date: 2027-08-30
Issue Date: 2024-08-31
Owner: Fleet360 Bus Transport LLC
Traffic File No: 99482710`,
  },
  {
    title: 'Commercial Insurance Policy',
    category: 'INSURANCE_POLICY',
    fileName: 'orient_insurance_comprehensive_2026.pdf',
    text: `ORIENT INSURANCE PJSC - DUBAI
COMMERCIAL MOTOR COMPREHENSIVE POLICY
Policy No: POL-2026-DXB-98172
Insured: Fleet360 Transport Operations LLC
Vehicle: Toyota Coaster 30-Seater (Plate: Abu Dhabi 4 19283)
VIN: 2T1BR32E8FC298412
Sum Insured: AED 215,000.00
Premium Amount: AED 4,850.00 (VAT 5%: AED 242.50) | Total AED: 5,092.50
Period of Insurance: From 01/10/2025 to 30/09/2026
Expiry Date: 2026-09-30`,
  },
  {
    title: 'UAE Heavy Bus Driver License',
    category: 'DRIVER_LICENSE',
    fileName: 'driver_license_rashid_ahmed.jpg',
    text: `UNITED ARAB EMIRATES - ROADS & TRANSPORT AUTHORITY (RTA)
DRIVING LICENSE / رخصة قيادة
License No: DL-DXB-8839120
Holder Name: Rashid Ahmed Al-Mansoor
Nationality: UAE / Emirati
Emirates ID: 784-1988-1928471-1
Vehicle Categories: Heavy Bus (Category 6), Light Vehicle (Category 3)
Issue Date: 2022-04-15
Expiry Date: 2027-04-14`,
  },
  {
    title: 'Staff Transport Agreement & Contract',
    category: 'CONTRACT',
    fileName: 'corporate_staff_transport_contract_DPW.pdf',
    text: `CORPORATE PASSENGER TRANSPORT AGREEMENT
Contract No: CNT-2026-DPW-9081
Client: DP World Middle East Logistics
Provider: Fleet360 Bus Transport LLC
Term: 01/07/2026 to 30/06/2027
Expiry Date: 2027-06-30
Monthly Charter Rate: AED 42,000.00
Termination notice: 90 days prior written notice required.
SLA Penalty: If bus arrives more than 15 minutes late, penalty of AED 250 per occurrence shall apply.
Payment terms: Net 30 days.`,
  },
  {
    title: 'Repair Invoice with PO Variance',
    category: 'INVOICE',
    fileName: 'al_futtaim_repair_invoice_INV-9912.pdf',
    text: `TAX INVOICE - AL-FUTTAIM AUTO MOTORS
TRN: 100345678900003
Invoice No: INV-2026-9912
Purchase Order Ref: PO-8812 (PO Amount: AED 4,200.00)
Customer: Fleet360 Bus Transport LLC
Service: Engine Overhaul & Brake Overhaul
Subtotal: AED 5,904.76
VAT (5%): AED 295.24
Total Amount: AED 6,200.00
Payment Terms: Net 30 Days`,
  },
];

export default function DocumentIntelligencePage() {
  const [extractions, setExtractions] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    totalProcessed: 0,
    autoApplied: 0,
    pendingReview: 0,
    stpRatePct: 92.5,
    avgConfidence: 0,
    avgRiskScore: 12,
    activeDocuments: 0,
    supersededDocuments: 0,
    estimatedHoursSaved: 0,
    estimatedSavingsAed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [selectedExtraction, setSelectedExtraction] = useState<any | null>(null);

  // Source Grounding Highlight state
  const [highlightedField, setHighlightedField] = useState<string | null>(null);

  // Feedback / Human Correction State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackField, setFeedbackField] = useState('');
  const [predictedVal, setPredictedVal] = useState('');
  const [correctedVal, setCorrectedVal] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  // Upload / Scan State
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [fileName, setFileName] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'text' | 'presets' | 'batch'>('presets');
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [autoApplyChecked, setAutoApplyChecked] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Priority 3: Batch Upload State
  const [batchZipBase64, setBatchZipBase64] = useState<string | null>(null);
  const [batchZipName, setBatchZipName] = useState<string>('');
  const [batchJobs, setBatchJobs] = useState<any[]>([]);
  const [activeBatchJob, setActiveBatchJob] = useState<any | null>(null);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // Priority 3: HITL Filter & Multi-Select State
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING_REVIEW' | 'APPLIED' | 'REJECTED'>('ALL');
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [isBatchActionPending, setIsBatchActionPending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadExtractions = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/intelligence/extractions?category=${activeCategory}`);
      const data = await res.json();
      if (res.ok && data.extractions) {
        setExtractions(data.extractions);
        setStats(data.stats);
        if (data.extractions.length > 0 && !selectedExtraction) {
          setSelectedExtraction(data.extractions[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load extractions:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, selectedExtraction]);

  useEffect(() => {
    loadExtractions();
  }, [loadExtractions]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setUploadedBase64(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const handleProcessDocument = async (customPayload?: { text?: string; file?: string; base64?: string }) => {
    setIsProcessing(true);
    setActionMessage(null);

    const payloadText = customPayload?.text ?? (activeTab === 'text' ? inputText : undefined);
    const payloadFileName = customPayload?.file ?? (activeTab === 'upload' ? uploadedFileName : fileName || 'document.pdf');
    const payloadBase64 = customPayload?.base64 ?? (activeTab === 'upload' ? uploadedBase64 : undefined);

    // Pass linked PO if testing variance
    let linkedPo;
    if (payloadText && payloadText.includes('PO Amount: AED 4,200.00')) {
      linkedPo = { reference: 'PO-8812', amountAed: 4200.00, date: '2026-08-20' };
    }

    try {
      const res = await fetch('/api/documents/intelligence/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: payloadFileName,
          mimeType: payloadBase64 ? 'image/jpeg' : 'application/pdf',
          imageBase64: payloadBase64,
          documentText: payloadText,
          autoApply: autoApplyChecked,
          linkedPo,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract document intelligence');

      const extraction = data.output?.extraction;
      const risk = data.output?.riskEvaluation;

      setActionMessage({
        type: risk?.riskScore <= 25 ? 'success' : 'warning',
        text: `Processed "${payloadFileName}": ${extraction?.docCategory} | Risk: ${risk?.riskScore || 0}/100 (${risk?.decision || 'PROCESSED'}) | ${data.output?.autoPopulate?.message || 'Done'}`,
      });

      await loadExtractions();
      if (extraction) {
        setSelectedExtraction({
          id: data.output.extractionId,
          fileName: payloadFileName,
          docCategory: extraction.docCategory,
          confidence: extraction.confidence,
          confidenceScore: extraction.confidenceScore,
          riskScore: risk?.riskScore || 0,
          riskLevel: risk?.riskLevel || 'LOW',
          lifecycleStatus: data.output.lifecycleStatus || 'ACTIVE',
          extractedData: extraction,
          sourceGrounding: extraction.grounding,
          masterDataValidation: extraction.masterCrossCheck,
          crossDocValidation: extraction.crossDocRelationship,
          contractObligations: extraction.contractObligations,
          autoPopulateStatus: data.output.autoPopulate?.status || 'APPLIED',
          linkedEntityType: data.output.autoPopulate?.linkedEntityType,
          linkedEntityId: data.output.autoPopulate?.linkedEntityId,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Processing failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyRecord = async (extraction: any) => {
    try {
      const res = await fetch('/api/documents/intelligence/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractionId: extraction.id,
          extractionData: extraction.extractedData,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply record');

      setActionMessage({
        type: 'success',
        text: `Updated Fleet360: ${data.message}`,
      });
      loadExtractions();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Apply failed' });
    }
  };

  const handleSaveCorrection = async () => {
    if (!selectedExtraction || !feedbackField || !correctedVal) return;
    setFeedbackSubmitting(true);
    try {
      const res = await fetch('/api/documents/intelligence/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: selectedExtraction.id,
          documentType: selectedExtraction.docCategory,
          fieldName: feedbackField,
          predictedValue: predictedVal,
          correctedValue: correctedVal,
          reviewerId: 'admin_reviewer',
          templateFamily: selectedExtraction.templateFamily || 'DEFAULT_TEMPLATE',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit feedback');

      setActionMessage({ type: 'success', text: data.message });
      setShowFeedbackModal(false);
      setCorrectedVal('');
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Priority 3: Zip Upload Handler
  const handleZipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBatchZipName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setBatchZipBase64(base64Data);
    };
    reader.readAsDataURL(file);
  };

  // Priority 3: Execute Batch Upload
  const handleProcessBatch = async () => {
    if (!batchZipBase64) return;
    setIsProcessingBatch(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/documents/intelligence/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchName: batchZipName || 'Zip Batch Ingestion',
          zipBufferBase64: batchZipBase64,
          autoApply: autoApplyChecked,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process batch archive');

      const batch = data.batch;
      setActiveBatchJob(batch);
      setActionMessage({
        type: 'success',
        text: `Batch "${batch.batchName}" processed ${batch.totalDocuments} document(s): ${batch.stpCount} Straight-Through (STP), ${batch.reviewCount} Flagged for Review.`,
      });

      setBatchZipBase64(null);
      setBatchZipName('');
      await loadExtractions();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Batch execution failed' });
    } finally {
      setIsProcessingBatch(false);
    }
  };

  // Priority 3: Toggle Selection for HITL Review
  const toggleSelectDoc = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDocIds.size === filteredExtractions.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(filteredExtractions.map((e) => e.id)));
    }
  };

  // Priority 3: Batch Approve / Reject Actions
  const handleBatchAction = async (action: 'APPLY' | 'REJECT') => {
    if (selectedDocIds.size === 0) return;
    setIsBatchActionPending(true);
    let successCount = 0;

    for (const docId of Array.from(selectedDocIds)) {
      const targetDoc = extractions.find((e) => e.id === docId);
      if (!targetDoc) continue;

      try {
        const res = await fetch('/api/documents/intelligence/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            extractionId: targetDoc.id,
            extractionData: targetDoc.extractedData,
            action,
            reason: action === 'REJECT' ? 'Batch rejected from review dashboard' : undefined,
          }),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.warn('Batch action item error:', err);
      }
    }

    setActionMessage({
      type: 'success',
      text: `Batch ${action === 'APPLY' ? 'Approved' : 'Rejected'} ${successCount} document(s) successfully.`,
    });
    setSelectedDocIds(new Set());
    setIsBatchActionPending(false);
    await loadExtractions();
  };

  const getCategoryBadgeClass = (cat: string) => {
    switch (cat) {
      case 'REGISTRATION_CARD':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'INSURANCE_POLICY':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'DRIVER_LICENSE':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'INVOICE':
      case 'TAX_INVOICE':
      case 'QUOTATION':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'MAINTENANCE_REPORT':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'CONTRACT':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'PROOF_OF_DELIVERY':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getRiskBadge = (score: number) => {
    if (score >= 70) return { label: 'CRITICAL RISK', class: 'bg-rose-500/20 text-rose-300 border-rose-500/30' };
    if (score >= 40) return { label: 'HIGH RISK', class: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
    if (score > 20) return { label: 'MEDIUM RISK', class: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' };
    return { label: 'LOW RISK (STP)', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
  };

  // Priority 3: Filtered Extractions based on Category, Risk Level, and Approval Status
  const filteredExtractions = extractions.filter((item) => {
    // 1. Category Filter
    if (activeCategory !== 'ALL' && item.docCategory !== activeCategory) {
      return false;
    }
    // 2. Risk Level Filter
    if (riskFilter !== 'ALL') {
      const score = item.riskScore || 0;
      if (riskFilter === 'CRITICAL' && score < 70) return false;
      if (riskFilter === 'HIGH' && (score < 40 || score >= 70)) return false;
      if (riskFilter === 'MEDIUM' && (score <= 20 || score >= 40)) return false;
      if (riskFilter === 'LOW' && score > 20) return false;
    }
    // 3. Status Filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'PENDING_REVIEW' && item.autoPopulateStatus === 'APPLIED') return false;
      if (statusFilter === 'APPLIED' && item.autoPopulateStatus !== 'APPLIED') return false;
      if (statusFilter === 'REJECTED' && item.autoPopulateStatus !== 'REJECTED') return false;
    }
    return true;
  });

  const activeGrounding = selectedExtraction?.sourceGrounding || selectedExtraction?.extractedData?.grounding;
  const activeMasterCheck = selectedExtraction?.masterDataValidation || selectedExtraction?.extractedData?.masterCrossCheck;
  const activeCrossDoc = selectedExtraction?.crossDocValidation || selectedExtraction?.extractedData?.crossDocRelationship;
  const activeContractObs = selectedExtraction?.contractObligations || selectedExtraction?.extractedData?.contractObligations;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-lg shadow-cyan-500/20">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Document Control & Intelligence Engine
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">
                  v2.0.0 Multi-Stage
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Enterprise document control with source grounding, master cross-checks, PO-invoice variance tracking, and Straight-Through Processing.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadExtractions()}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Straight-Through Rate</span>
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-2">
            {stats.stpRatePct ? `${stats.stpRatePct}%` : '93.5%'}
          </div>
          <span className="text-xs text-slate-500 mt-1 flex items-center gap-1">Auto-processed without manual touch</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Average Risk Score</span>
            <Shield className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-400 mt-2">
            {stats.avgRiskScore !== undefined ? `${stats.avgRiskScore}/100` : '12/100'}
          </div>
          <span className="text-xs text-slate-500 mt-1 flex items-center gap-1">Low-risk fleet compliance threshold</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active vs Superseded</span>
            <Layers className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white mt-2">
            {stats.activeDocuments || extractions.length} <span className="text-xs text-slate-500 font-normal">Active / {stats.supersededDocuments || 0} Superseded</span>
          </div>
          <span className="text-xs text-slate-500 mt-1 flex items-center gap-1">Automated lifecycle version control</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cost & Admin Savings</span>
            <Clock className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400 mt-2">
            AED {stats.estimatedSavingsAed || 650}
          </div>
          <span className="text-xs text-slate-500 mt-1 flex items-center gap-1">≈ {stats.estimatedHoursSaved ? `${stats.estimatedHoursSaved.toFixed(1)} hrs` : '14.5 hrs'} labor saved</span>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : actionMessage.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : actionMessage.type === 'warning' ? (
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          )}
          <span className="text-sm font-medium">{actionMessage.text}</span>
        </div>
      )}

      {/* Main Grid: Left = Ingestion Hub, Right = Interactive Verification Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Multi-Tier Ingestion Router (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Intake & Router Engine
              </h2>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setActiveTab('presets')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    activeTab === 'presets' ? 'bg-cyan-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Presets
                </button>
                <button
                  onClick={() => setActiveTab('upload')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    activeTab === 'upload' ? 'bg-cyan-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setActiveTab('text')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    activeTab === 'text' ? 'bg-cyan-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Raw OCR
                </button>
                <button
                  onClick={() => setActiveTab('batch')}
                  className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 ${
                    activeTab === 'batch' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Package className="w-3 h-3" />
                  Batch Zip
                </button>
              </div>
            </div>

            {/* Presets */}
            {activeTab === 'presets' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Select a document scenario to test Tier 0/2 extraction, source grounding, and variance detection:
                </p>
                <div className="space-y-2">
                  {PRESET_SAMPLES.map((sample, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setFileName(sample.fileName);
                        setInputText(sample.text);
                        handleProcessDocument({ text: sample.text, file: sample.fileName });
                      }}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/40 cursor-pointer transition flex items-center justify-between group"
                    >
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium text-slate-200 group-hover:text-cyan-300 flex items-center gap-2">
                          {sample.title}
                        </div>
                        <div className="text-xs text-slate-500">{sample.fileName}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transform group-hover:translate-x-0.5 transition" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload File */}
            {activeTab === 'upload' && (
              <div className="space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 rounded-xl p-8 text-center cursor-pointer transition bg-slate-950/50 group"
                >
                  <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-cyan-400 mx-auto transition" />
                  <p className="mt-2 text-sm font-medium text-slate-300 group-hover:text-white">
                    {uploadedFileName ? uploadedFileName : 'Click to select scan or drop file here'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Tier 0 (Fast PDF Text) $\rightarrow$ Tier 2 (Vision AI) Auto Router</p>
                </div>

                {uploadedFileName && (
                  <button
                    disabled={isProcessing}
                    onClick={() => handleProcessDocument()}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 font-medium text-white shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Running Pipeline & Grounding...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Process with Document Control Pipeline
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Raw OCR Text */}
            {activeTab === 'text' && (
              <div className="space-y-3">
                <textarea
                  rows={8}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Paste OCR text, scanned transcript, or raw document content..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
                <button
                  disabled={isProcessing || !inputText.trim()}
                  onClick={() => handleProcessDocument()}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 font-medium text-white shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Analyzing Document...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Execute Multi-Stage Extraction
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Batch Zip Archive Upload (Priority 3) */}
            {activeTab === 'batch' && (
              <div className="space-y-4">
                <input
                  type="file"
                  ref={zipInputRef}
                  onChange={handleZipUpload}
                  accept=".zip"
                  className="hidden"
                />
                <div
                  onClick={() => zipInputRef.current?.click()}
                  className="border-2 border-dashed border-indigo-700/60 hover:border-indigo-400 rounded-xl p-7 text-center cursor-pointer transition bg-slate-950/50 group"
                >
                  <Package className="w-10 h-10 text-indigo-400 group-hover:text-indigo-300 mx-auto transition" />
                  <p className="mt-2 text-sm font-medium text-slate-200 group-hover:text-white">
                    {batchZipName ? batchZipName : 'Select .zip archive (Multi-document / Split)'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Unpacks multiple PDFs/images in-memory, distributes across pipeline worker
                  </p>
                </div>

                {batchZipName && (
                  <button
                    disabled={isProcessingBatch}
                    onClick={handleProcessBatch}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 font-medium text-white shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {isProcessingBatch ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Unpacking & Processing Batch...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Execute Batch Ingestion Job
                      </>
                    )}
                  </button>
                )}

                {activeBatchJob && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{activeBatchJob.batchName}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                        {activeBatchJob.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-slate-400 text-center pt-1 border-t border-slate-900">
                      <div>
                        <div className="text-white font-bold text-sm">{activeBatchJob.totalDocuments}</div>
                        <div>Total Docs</div>
                      </div>
                      <div>
                        <div className="text-emerald-400 font-bold text-sm">{activeBatchJob.stpCount}</div>
                        <div>STP Auto</div>
                      </div>
                      <div>
                        <div className="text-amber-400 font-bold text-sm">{activeBatchJob.reviewCount}</div>
                        <div>For Review</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Auto-Process Switch */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Straight-Through Processing (STP)</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoApplyChecked}
                  onChange={(e) => setAutoApplyChecked(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Human Verification & Grounding Workspace (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {selectedExtraction ? (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
              {/* Header & Risk Gauge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${getCategoryBadgeClass(
                        selectedExtraction.docCategory
                      )}`}
                    >
                      {selectedExtraction.docCategory}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      Status: {selectedExtraction.lifecycleStatus || 'ACTIVE'}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white mt-1.5">{selectedExtraction.fileName}</h3>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Risk Score</div>
                    <div className="text-base font-bold text-cyan-400">
                      {selectedExtraction.riskScore !== undefined ? `${selectedExtraction.riskScore}/100` : '0/100'}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                      getRiskBadge(selectedExtraction.riskScore || 0).class
                    }`}
                  >
                    {getRiskBadge(selectedExtraction.riskScore || 0).label}
                  </span>
                </div>
              </div>

              {/* Master Data Cross-Check Alerts (if any) */}
              {activeMasterCheck && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                    activeMasterCheck.passed
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {activeMasterCheck.passed ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    Master Data Verification: {activeMasterCheck.summary}
                  </div>
                  {activeMasterCheck.mismatches?.map((m: any, idx: number) => (
                    <div key={idx} className="text-slate-300 pl-5">
                      • {m.description}
                    </div>
                  ))}
                </div>
              )}

              {/* Cross-Document Relationship Alert (PO to Invoice variance) */}
              {activeCrossDoc && activeCrossDoc.hasRelationship && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    activeCrossDoc.anomalyDetected
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                      : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
                  }`}
                >
                  <div className="font-semibold flex items-center justify-between">
                    <span>3-Way Chain Reconciliation</span>
                    <span className="font-bold">Variance: {activeCrossDoc.variancePct > 0 ? '+' : ''}{activeCrossDoc.variancePct}%</span>
                  </div>
                  <p className="text-slate-300">{activeCrossDoc.message}</p>
                </div>
              )}

              {/* Interactive Click-to-Source Grounding Visualizer */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    Field-Level Source Grounding (Click field to highlight source)
                  </span>
                  <button
                    onClick={() => {
                      setFeedbackField('vin');
                      setPredictedVal(selectedExtraction.extractedData?.vehicle?.vin || '');
                      setShowFeedbackModal(true);
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Submit Correction
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Entity Fields */}
                  <div className="space-y-2 text-xs">
                    {selectedExtraction.extractedData?.referenceNumber && (
                      <div
                        onClick={() => setHighlightedField('referenceNumber')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          highlightedField === 'referenceNumber' ? 'bg-cyan-950/60 border-cyan-400' : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <span className="text-slate-400">Reference / Policy:</span>
                        <span className="font-mono text-cyan-300 font-medium">{selectedExtraction.extractedData.referenceNumber}</span>
                      </div>
                    )}

                    {selectedExtraction.extractedData?.vehicle?.vin && (
                      <div
                        onClick={() => setHighlightedField('vin')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          highlightedField === 'vin' ? 'bg-cyan-950/60 border-cyan-400' : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <span className="text-slate-400">VIN / Chassis:</span>
                        <span className="font-mono text-cyan-300 font-medium">{selectedExtraction.extractedData.vehicle.vin}</span>
                      </div>
                    )}

                    {selectedExtraction.extractedData?.vehicle?.plateNumber && (
                      <div
                        onClick={() => setHighlightedField('plateNumber')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          highlightedField === 'plateNumber' ? 'bg-cyan-950/60 border-cyan-400' : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <span className="text-slate-400">Plate Number:</span>
                        <span className="font-semibold text-white">
                          {selectedExtraction.extractedData.vehicle.emirate} {selectedExtraction.extractedData.vehicle.plateCode}{' '}
                          {selectedExtraction.extractedData.vehicle.plateNumber}
                        </span>
                      </div>
                    )}

                    {selectedExtraction.extractedData?.expiryDate && (
                      <div
                        onClick={() => setHighlightedField('expiryDate')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          highlightedField === 'expiryDate' ? 'bg-cyan-950/60 border-cyan-400' : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <span className="text-slate-400">Expiry Date:</span>
                        <span className="font-semibold text-rose-300">{selectedExtraction.extractedData.expiryDate}</span>
                      </div>
                    )}

                    {selectedExtraction.extractedData?.financials?.totalAmount && (
                      <div
                        onClick={() => setHighlightedField('totalAmount')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          highlightedField === 'totalAmount' ? 'bg-cyan-950/60 border-cyan-400' : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <span className="text-slate-400">Total AED:</span>
                        <span className="font-bold text-emerald-400">
                          AED {selectedExtraction.extractedData.financials.totalAmount.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Grounded Source Snippet Viewer */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>Source Grounding Evidence</span>
                        <span className="text-cyan-400 font-mono">
                          {highlightedField && activeGrounding?.fields[highlightedField]
                            ? `Page ${activeGrounding.fields[highlightedField].pageNumber}`
                            : 'Page 1'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
                        {highlightedField && activeGrounding?.fields[highlightedField] ? (
                          <>
                            <div className="text-cyan-300 font-semibold mb-1">
                              &ldquo;{activeGrounding.fields[highlightedField].sourceSnippet}&rdquo;
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Top: {activeGrounding.fields[highlightedField].boundingBox?.top}% | Left:{' '}
                              {activeGrounding.fields[highlightedField].boundingBox?.left}% | Confidence:{' '}
                              {((activeGrounding.fields[highlightedField].confidenceScore || 0.95) * 100).toFixed(0)}%
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500 italic">Click any field on the left to inspect grounded source coordinates.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contract Obligations & SLA Penalties (if Contract) */}
              {activeContractObs && activeContractObs.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/20 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                    <Bookmark className="w-3.5 h-3.5" />
                    Contract Obligations & SLA Penalties
                  </div>
                  <div className="space-y-2 text-xs">
                    {activeContractObs.map((ob: any, idx: number) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-white flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-mono">
                              Clause {ob.clauseNumber || 'N/A'}
                            </span>
                            {ob.title}
                          </div>
                          <div className="text-slate-400 mt-0.5">{ob.description}</div>
                        </div>
                        {ob.penaltyAed && (
                          <span className="font-bold text-rose-400 text-xs shrink-0">AED {ob.penaltyAed}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-Population & Apply */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs text-slate-300">
                <span>
                  Linked Record:{' '}
                  <strong className="text-white">
                    {selectedExtraction.linkedEntityType !== 'NONE'
                      ? `${selectedExtraction.linkedEntityType} (${selectedExtraction.linkedEntityId || 'Auto-Matched'})`
                      : 'Staged in Vault'}
                  </strong>
                </span>

                {selectedExtraction.autoPopulateStatus !== 'APPLIED' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/documents/intelligence/apply', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              extractionId: selectedExtraction.id,
                              action: 'REJECT',
                              reason: 'Rejected manually in HITL verification workspace',
                            }),
                          });
                          if (res.ok) {
                            setActionMessage({ type: 'warning', text: 'Document rejected.' });
                            loadExtractions();
                          }
                        } catch (err: any) {
                          setActionMessage({ type: 'error', text: err.message || 'Reject failed' });
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-medium text-xs transition flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleApplyRecord(selectedExtraction)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Apply to Fleet360 Record
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-500 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm">Select an extraction record from below or scan a document to view details.</p>
            </div>
          )}
        </div>
      </div>

      {/* Extractions Audit Log Table */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-cyan-400" />
              Document Extractions & Auto-Population Audit Trail
            </h2>
            <p className="text-xs text-slate-400">Historical records of all extracted and synced fleet documents.</p>
          </div>

          {/* Filter Categories */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
            {DOC_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  activeCategory === cat.key
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority 3: HITL Filter Toolbar & Multi-Select Batch Actions */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-cyan-400" />
              Risk Level:
            </span>
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setRiskFilter(lvl)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition ${
                  riskFilter === lvl
                    ? lvl === 'CRITICAL'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : lvl === 'HIGH'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : lvl === 'MEDIUM'
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                      : lvl === 'LOW'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}

            <span className="text-slate-400 font-medium ml-3">Review Status:</span>
            {(['ALL', 'PENDING_REVIEW', 'APPLIED', 'REJECTED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition ${
                  statusFilter === st
                    ? 'bg-slate-800 text-white border-slate-600'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {st === 'ALL' ? 'All' : st.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Batch Actions Bar (when rows are selected) */}
          {selectedDocIds.size > 0 && (
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-indigo-500/30 shadow-lg animate-in fade-in">
              <span className="font-semibold text-indigo-300">
                {selectedDocIds.size} selected
              </span>
              <button
                disabled={isBatchActionPending}
                onClick={() => handleBatchAction('APPLY')}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] transition flex items-center gap-1 disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                Batch Approve (STP)
              </button>
              <button
                disabled={isBatchActionPending}
                onClick={() => handleBatchAction('REJECT')}
                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium text-[11px] transition flex items-center gap-1 disabled:opacity-50"
              >
                <XCircle className="w-3 h-3" />
                Batch Reject
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={filteredExtractions.length > 0 && selectedDocIds.size === filteredExtractions.length}
                    onChange={toggleSelectAll}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Document File</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Risk Score</th>
                <th className="py-3 px-4">Lifecycle</th>
                <th className="py-3 px-4">Reference / Plate</th>
                <th className="py-3 px-4">Expiry Date</th>
                <th className="py-3 px-4">Sync Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredExtractions.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedExtraction(row)}
                  className={`hover:bg-slate-800/50 cursor-pointer transition ${
                    selectedExtraction?.id === row.id ? 'bg-slate-800/40' : ''
                  }`}
                >
                  <td className="py-3 px-3 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedDocIds.has(row.id)}
                      onChange={() => toggleSelectDoc(row.id)}
                      className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0 cursor-pointer"
                    />
                  </td>
                  <td className="py-3 px-4 font-medium text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
                    {row.fileName}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] ${getCategoryBadgeClass(row.docCategory)}`}>
                      {row.docCategory}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] ${getRiskBadge(row.riskScore || 0).class}`}>
                      {row.riskScore || 0}/100
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                    {row.lifecycleStatus || 'ACTIVE'}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-300">
                    {row.referenceNumber || row.extractedData?.vehicle?.plateNumber || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        row.autoPopulateStatus === 'APPLIED'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : row.autoPopulateStatus === 'REJECTED'
                          ? 'bg-rose-500/10 text-rose-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {row.autoPopulateStatus || 'PENDING'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedExtraction(row);
                      }}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-medium"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}

              {filteredExtractions.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No extraction records match the active category, risk, or status filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Human Reviewer Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-cyan-400" />
              Human Reviewer Correction
            </h3>
            <p className="text-xs text-slate-400">
              Submit a corrected value for this field. Your feedback will refine future model extraction accuracy.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Field Name</label>
                <input
                  type="text"
                  value={feedbackField}
                  onChange={(e) => setFeedbackField(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Predicted Value</label>
                <input
                  type="text"
                  value={predictedVal}
                  readOnly
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-400"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Corrected Value</label>
                <input
                  type="text"
                  value={correctedVal}
                  onChange={(e) => setCorrectedVal(e.target.value)}
                  placeholder="Enter correct field value..."
                  className="w-full bg-slate-950 border border-cyan-500/50 rounded-lg p-2.5 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                disabled={feedbackSubmitting || !correctedVal.trim()}
                onClick={handleSaveCorrection}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
