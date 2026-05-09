'use client';
import React, { useState, useEffect, useCallback } from 'react';

//  Constants 
const MODULES = [
  { key: 'LEASING',        label: 'Leasing',              icon: 'L', color: 'from-blue-500 to-indigo-600',    light: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { key: 'RAC',            label: 'Rent-a-Car',           icon: 'R', color: 'from-emerald-500 to-teal-600',   light: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { key: 'STAFF_TRANSPORT',label: 'Staff Transport',      icon: 'S', color: 'from-violet-500 to-purple-600',  light: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { key: 'SCHOOL_BUS',     label: 'School Bus',           icon: 'B', color: 'from-amber-500 to-orange-600',   light: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { key: 'LOGISTICS',      label: 'Logistics',            icon: 'G', color: 'from-rose-500 to-pink-600',      light: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  { key: 'INCIDENT',       label: 'Incident / Ambulance', icon: 'I', color: 'from-red-500 to-rose-600',       light: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { key: 'BOOKING',        label: 'Booking & Dispatch',   icon: 'D', color: 'from-cyan-500 to-sky-600',       light: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
];

const PROCEDURES: Record<string, { key: string; label: string; description: string }[]> = {
  LEASING: [
    { key: 'QUOTATION_APPROVAL',    label: 'Quotation Approval',      description: 'Internal sign-off on lease quotations before sending to customer' },
    { key: 'CONTRACT_APPROVAL',     label: 'Contract Approval',       description: 'Approval of final lease contract before execution' },
    { key: 'CREDIT_APPROVAL',       label: 'Credit Approval',         description: 'Credit risk assessment and approval workflow' },
    { key: 'PO_REQUEST',            label: 'Purchase Order Request',  description: 'Internal PO creation and procurement workflow' },
    { key: 'EARLY_TERMINATION',     label: 'Early Termination',       description: 'Approval for early contract termination requests' },
    { key: 'VEHICLE_ADDITION',      label: 'Vehicle Addition',        description: 'Approval to add vehicles to an active lease contract' },
  ],
  RAC: [
    { key: 'BOOKING_APPROVAL',      label: 'Booking Approval',        description: 'Approval for new rental bookings above threshold' },
    { key: 'DAMAGE_CLAIM',          label: 'Damage Claim',            description: 'Assessment and approval of vehicle damage claims' },
    { key: 'REFUND_APPROVAL',       label: 'Refund Approval',         description: 'Customer refund request approval workflow' },
    { key: 'RATE_OVERRIDE',         label: 'Rate Override',           description: 'Approval when rates are discounted below standard' },
  ],
  STAFF_TRANSPORT: [
    { key: 'ROUTE_APPROVAL',        label: 'Route Approval',          description: 'New route creation or change approval' },
    { key: 'DRIVER_ASSIGNMENT',     label: 'Driver Assignment',       description: 'Driver to route assignment workflow' },
    { key: 'INCIDENT_REPORT',       label: 'Incident Report',         description: 'Transport incident investigation and closure' },
    { key: 'VEHICLE_REQUEST',       label: 'Vehicle Request',         description: 'Ad-hoc vehicle request approval' },
  ],
  SCHOOL_BUS: [
    { key: 'ROUTE_APPROVAL',        label: 'Route Approval',          description: 'School bus route creation or modification' },
    { key: 'STUDENT_ONBOARD',       label: 'Student Onboarding',      description: 'Student boarding and parent consent workflow' },
    { key: 'INCIDENT_REPORT',       label: 'Incident Report',         description: 'Bus incident investigation and parent notification' },
    { key: 'DRIVER_VERIFICATION',   label: 'Driver Verification',     description: 'Driver background check and certification approval' },
  ],
  LOGISTICS: [
    { key: 'SHIPMENT_APPROVAL',     label: 'Shipment Approval',       description: 'Outbound shipment authorization workflow' },
    { key: 'CUSTOMS_CLEARANCE',     label: 'Customs Clearance',       description: 'Customs documentation approval chain' },
    { key: 'DELIVERY_CONFIRMATION', label: 'Delivery Confirmation',   description: 'Proof of delivery and sign-off workflow' },
    { key: 'DAMAGE_CLAIM',          label: 'Cargo Damage Claim',      description: 'Cargo damage assessment and claim processing' },
  ],
  INCIDENT: [
    { key: 'INCIDENT_REPORT',       label: 'Incident Report',         description: 'Multi-level incident investigation workflow' },
    { key: 'AMBULANCE_DISPATCH',    label: 'Ambulance Dispatch',      description: 'Emergency dispatch authorization and tracking' },
    { key: 'CASE_CLOSURE',          label: 'Case Closure',            description: 'Incident case closure and archival approval' },
    { key: 'INSURANCE_CLAIM',       label: 'Insurance Claim',         description: 'Insurance claim submission and approval' },
  ],
  BOOKING: [
    { key: 'BOOKING_APPROVAL',      label: 'Booking Approval',        description: 'Dispatch booking review and approval' },
    { key: 'DRIVER_DISPATCH',       label: 'Driver Dispatch',         description: 'Driver dispatch authorization workflow' },
    { key: 'JOURNEY_COMPLETION',    label: 'Journey Completion',      description: 'Journey sign-off and billing trigger' },
  ],
};

const STEP_TYPES = [
  { value: 'APPROVAL',     label: 'Approval',      desc: 'Requires manual approval',      icon: 'CHECK', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { value: 'NOTIFICATION', label: 'Notification',  desc: 'Sends email, auto-advances',    icon: 'BELL',  color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { value: 'AUTO_APPROVE', label: 'Auto Approve',  desc: 'Automatically approved',        icon: 'AUTO',  color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
];

const ASSIGNEE_TYPES = [
  { value: 'SPECIFIC_USER',    label: 'Specific User',     desc: 'Route to a named email address' },
  { value: 'ROLE',             label: 'By Role',           desc: 'Any user with the specified role' },
  { value: 'DIRECT_MANAGER',   label: 'Direct Manager',    desc: "Route to submitter's direct manager" },
  { value: 'DEPARTMENT_HEAD',  label: 'Department Head',   desc: "Route to submitter's department head" },
  { value: 'MULTI_USER',       label: 'Multiple Users',    desc: 'Send to multiple approvers' },
];

const CONDITION_OPERATORS = [
  { value: 'GT',  label: 'Greater than' },
  { value: 'GTE', label: 'Greater than or equal' },
  { value: 'LT',  label: 'Less than' },
  { value: 'LTE', label: 'Less than or equal' },
  { value: 'EQ',  label: 'Equal to' },
  { value: 'NEQ', label: 'Not equal to' },
];

const CONDITION_FIELDS = [
  { value: 'totalValue',     label: 'Total Contract Value (AED)' },
  { value: 'monthlyRate',    label: 'Monthly Rate (AED)' },
  { value: 'vehicleCount',   label: 'Number of Vehicles' },
  { value: 'duration',       label: 'Lease Duration (months)' },
  { value: 'creditScore',    label: 'Credit Score' },
];

//  Interfaces 
interface Workflow {
  id: string; name: string; module: string; procedure: string;
  description: string; isActive: boolean; stepCount: number; activeInstances: number;
}

interface WorkflowStep {
  id: string; workflowId: string; stepOrder: number; stepName: string;
  stepType: string; assigneeType: string; assigneeEmail: string; assigneeRoleCode: string;
  multiApproverEmails: string; requireAllApprovers: boolean;
  emailSubject: string; emailBody: string; slaHours: number;
  escalationEmail: string; escalationHours: number;
  conditionJson: string; isOptional: boolean;
}

interface Stats { total: number; active: number; pendingApprovals: number; activeInstances: number; }

const emptyStep = (): Partial<WorkflowStep> => ({
  stepOrder: 1, stepName: '', stepType: 'APPROVAL', assigneeType: 'SPECIFIC_USER',
  assigneeEmail: '', assigneeRoleCode: '', multiApproverEmails: '', requireAllApprovers: false,
  emailSubject: '', emailBody: '', slaHours: 24, escalationEmail: '', escalationHours: 48,
  conditionJson: '', isOptional: false,
});

//  Helper: parse condition JSON 
function parseCondition(json: string) {
  try { return json ? JSON.parse(json) : null; } catch { return null; }
}
function serializeCondition(field: string, operator: string, value: string) {
  if (!field || !operator || !value) return '';
  return JSON.stringify({ field, operator, value });
}

//  Step type icon 
function StepIcon({ type, order }: { type: string; order: number }) {
  if (type === 'APPROVAL')     return <span className="text-violet-300 text-xs font-bold">{order}</span>;
  if (type === 'NOTIFICATION') return <span className="text-blue-300 text-xs font-bold">N</span>;
  if (type === 'AUTO_APPROVE') return <span className="text-emerald-300 text-xs font-bold">A</span>;
  return <span className="text-slate-300 text-xs font-bold">{order}</span>;
}

//  Main Component 
export default function WorkflowsPage() {
  const [activeModule, setActiveModule] = useState('LEASING');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, pendingApprovals: 0, activeInstances: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null);
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [showNewWf, setShowNewWf] = useState(false);
  const [showStepEditor, setShowStepEditor] = useState(false);
  const [editingStep, setEditingStep] = useState<Partial<WorkflowStep> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [stepTab, setStepTab] = useState<'basic'|'assignee'|'email'|'advanced'>('basic');
  // condition state in step editor
  const [condField, setCondField] = useState('');
  const [condOp, setCondOp] = useState('GT');
  const [condVal, setCondVal] = useState('');
  const [showCondition, setShowCondition] = useState(false);

  const [newWf, setNewWf] = useState({
    name: '', module: 'LEASING', procedure: 'QUOTATION_APPROVAL', description: '',
  });

  const [showEditWf, setShowEditWf] = useState(false);
  const [editingWf, setEditingWf] = useState<Workflow | null>(null);
  const [editWfTab, setEditWfTab] = useState<'basic'|'assignee'|'email'|'conditions'>('basic');
  const [editWfForm, setEditWfForm] = useState({
    name: '', module: '', procedure: '', description: '', isActive: true,
    defaultAssigneeType: 'SPECIFIC_USER', defaultAssigneeEmail: '', defaultAssigneeRoleCode: '',
    defaultEmailSubject: '', defaultEmailBody: '',
    defaultSlaHours: 24, defaultEscalationEmail: '', defaultEscalationHours: 48,
  });

  const loadStats = async () => {
    try {
      const res = await fetch('/api/admin/workflows/stats');
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  };

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/workflows?module=${activeModule}`);
      const data = await res.json();
      setWorkflows(Array.isArray(data) ? data : []);
    } catch { setWorkflows([]); }
    finally { setLoading(false); }
  }, [activeModule]);

  const loadSteps = async (wfId: string) => {
    setStepsLoading(true);
    try {
      const res = await fetch(`/api/admin/workflows/${wfId}`);
      const data = await res.json();
      setWfSteps(data.steps ?? []);
    } catch { setWfSteps([]); }
    finally { setStepsLoading(false); }
  };

  useEffect(() => { Promise.all([loadWorkflows(), loadStats()]); }, [activeModule, loadWorkflows]);

  const handleSelectWf = (wf: Workflow) => {
    setSelectedWf(wf); loadSteps(wf.id); setMsg('');
  };

  const handleCreateWf = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWf),
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewWf(false);
        setNewWf({ name: '', module: 'LEASING', procedure: 'QUOTATION_APPROVAL', description: '' });
        await loadWorkflows(); await loadStats();
        setMsg('Workflow created successfully');
      } else { setMsg(`Error: ${data.error}`); }
    } catch { setMsg('Error: Failed to create'); }
    setSaving(false);
  };

  const handleToggleActive = async (wf: Workflow) => {
    await fetch(`/api/admin/workflows/${wf.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !wf.isActive }),
    });
    loadWorkflows(); loadStats();
  };

  const handleDeleteWf = async (wf: Workflow) => {
    if (!confirm(`Delete "${wf.name}"? All steps will be removed. This cannot be undone.`)) return;
    await fetch(`/api/admin/workflows/${wf.id}`, { method: 'DELETE' });
    if (selectedWf?.id === wf.id) { setSelectedWf(null); setWfSteps([]); }
    loadWorkflows(); loadStats();
    setMsg('Workflow deleted');
  };

  const handleDuplicate = async (wf: Workflow) => {
    const res = await fetch(`/api/admin/workflows/${wf.id}/duplicate`, { method: 'POST' });
    if (res.ok) { loadWorkflows(); setMsg(`Duplicated: ${wf.name}`); }
  };

  const handleOpenEditWf = async (wf: Workflow) => {
    setEditingWf(wf);
    setEditWfTab('basic');
    // Load full workflow data (includes default fields)
    try {
      const res = await fetch(`/api/admin/workflows/${wf.id}`);
      const data = res.ok ? await res.json() : wf;
      setEditWfForm({
        name: data.name ?? wf.name,
        module: data.module ?? wf.module,
        procedure: data.procedure ?? wf.procedure,
        description: data.description ?? '',
        isActive: data.isActive ?? wf.isActive,
        defaultAssigneeType: data.defaultAssigneeType ?? 'SPECIFIC_USER',
        defaultAssigneeEmail: data.defaultAssigneeEmail ?? '',
        defaultAssigneeRoleCode: data.defaultAssigneeRoleCode ?? '',
        defaultEmailSubject: data.defaultEmailSubject ?? '',
        defaultEmailBody: data.defaultEmailBody ?? '',
        defaultSlaHours: data.defaultSlaHours ?? 24,
        defaultEscalationEmail: data.defaultEscalationEmail ?? '',
        defaultEscalationHours: data.defaultEscalationHours ?? 48,
      });
    } catch {
      setEditWfForm({ name: wf.name, module: wf.module, procedure: wf.procedure, description: wf.description ?? '', isActive: wf.isActive, defaultAssigneeType: 'SPECIFIC_USER', defaultAssigneeEmail: '', defaultAssigneeRoleCode: '', defaultEmailSubject: '', defaultEmailBody: '', defaultSlaHours: 24, defaultEscalationEmail: '', defaultEscalationHours: 48 });
    }
    setShowEditWf(true);
  };

  const handleSaveEditWf = async () => {
    if (!editingWf) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workflows/${editingWf.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editWfForm),
      });
      if (res.ok) {
        setShowEditWf(false);
        setEditingWf(null);
        await loadWorkflows();
        await loadStats();
        if (selectedWf?.id === editingWf.id) {
          setSelectedWf(prev => prev ? { ...prev, ...editWfForm } : prev);
        }
        setMsg('Workflow updated successfully');
      } else {
        const d = await res.json();
        setMsg(`Error: ${d.error}`);
      }
    } catch { setMsg('Error: Failed to update'); }
    setSaving(false);
  };

  const openStepEditor = (step?: WorkflowStep) => {
    const s = step ? { ...step } : { ...emptyStep(), stepOrder: wfSteps.length + 1 };
    setEditingStep(s);
    setStepTab('basic');
    if (step?.conditionJson) {
      const c = parseCondition(step.conditionJson);
      if (c) { setCondField(c.field ?? ''); setCondOp(c.operator ?? 'GT'); setCondVal(c.value ?? ''); setShowCondition(true); }
      else { setCondField(''); setCondOp('GT'); setCondVal(''); setShowCondition(false); }
    } else {
      setCondField(''); setCondOp('GT'); setCondVal(''); setShowCondition(false);
    }
    setShowStepEditor(true);
  };

  const handleSaveStep = async () => {
    if (!selectedWf || !editingStep) return;
    setSaving(true);
    try {
      const conditionJson = showCondition ? serializeCondition(condField, condOp, condVal) : '';
      const payload = { ...editingStep, conditionJson };
      const isEdit = !!editingStep.id;
      const url = isEdit
        ? `/api/admin/workflows/${selectedWf.id}/steps/${editingStep.id}`
        : `/api/admin/workflows/${selectedWf.id}/steps`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowStepEditor(false); setEditingStep(null);
        await loadSteps(selectedWf.id); await loadWorkflows();
        setMsg('Step saved');
      } else {
        const d = await res.json(); setMsg(`Error: ${d.error}`);
      }
    } catch { setMsg('Error saving step'); }
    setSaving(false);
  };

  const handleDeleteStep = async (step: WorkflowStep) => {
    if (!selectedWf || !confirm(`Remove step "${step.stepName}"?`)) return;
    await fetch(`/api/admin/workflows/${selectedWf.id}/steps/${step.id}`, { method: 'DELETE' });
    await loadSteps(selectedWf.id); await loadWorkflows();
  };

  const moveStep = async (step: WorkflowStep, dir: -1 | 1) => {
    if (!selectedWf) return;
    const newOrder = step.stepOrder + dir;
    if (newOrder < 1 || newOrder > wfSteps.length) return;
    const swap = wfSteps.find(s => s.stepOrder === newOrder);
    if (swap) {
      await fetch(`/api/admin/workflows/${selectedWf.id}/steps/${swap.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepOrder: step.stepOrder }),
      });
    }
    await fetch(`/api/admin/workflows/${selectedWf.id}/steps/${step.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepOrder: newOrder }),
    });
    loadSteps(selectedWf.id);
  };

  const getStepTypeStyle = (type: string) =>
    STEP_TYPES.find(t => t.value === type)?.color ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  const getModuleMeta = (key: string) => MODULES.find(m => m.key === key);
  const getProcedures = (mod: string) => PROCEDURES[mod] ?? [];
  const getProcLabel = (mod: string, key: string) =>
    getProcedures(mod).find(p => p.key === key)?.label ?? key.replace(/_/g, ' ');


  //  Render 
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Business Rule & Workflow Management</h1>
          <p className="text-slate-400 text-sm">Define approval chains, notification rules, and escalation paths for all platform modules</p>
        </div>
        <button onClick={() => setShowNewWf(true)}
          className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg">
          + New Workflow
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Workflows', value: stats.total, color: 'text-white', bg: 'bg-slate-800/60 border-white/10' },
          { label: 'Active Workflows', value: stats.active, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: 'Live Instances', value: stats.activeInstances, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
          { label: 'Pending Approvals', value: stats.pendingApprovals, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-slate-400 text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm border flex items-center justify-between ${msg.startsWith('Error') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
          <span>{msg}</span>
          <button onClick={() => setMsg('')} className="text-lg leading-none opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* Module Tabs */}
      <div className="flex gap-2 flex-wrap">
        {MODULES.map(m => (
          <button key={m.key} onClick={() => { setActiveModule(m.key); setSelectedWf(null); setWfSteps([]); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeModule === m.key ? `bg-gradient-to-r ${m.color} text-white shadow-lg` : 'bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60 border border-white/5'}`}>
            <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${activeModule === m.key ? 'bg-white/20' : 'bg-slate-700'}`}>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Main 2-panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left: Procedures + Workflows */}
        <div className="lg:col-span-2 space-y-4">
          {/* Procedure Reference */}
          <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <span className={`w-6 h-6 rounded bg-gradient-to-br ${getModuleMeta(activeModule)?.color ?? 'from-slate-500 to-slate-600'} flex items-center justify-center text-white text-xs font-bold`}>
                {getModuleMeta(activeModule)?.icon}
              </span>
              <p className="text-white font-semibold text-sm">{getModuleMeta(activeModule)?.label} Procedures</p>
            </div>
            <div className="p-2 space-y-1">
              {getProcedures(activeModule).map(proc => {
                const hasWf = workflows.some(w => w.procedure === proc.key);
                return (
                  <div key={proc.key} className="px-3 py-2 rounded-xl flex items-center justify-between gap-2 hover:bg-white/5 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-300 text-xs font-semibold">{proc.label}</p>
                      <p className="text-slate-600 text-xs truncate">{proc.description}</p>
                    </div>
                    {hasWf
                      ? <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Defined</span>
                      : <button onClick={() => { setNewWf(p => ({ ...p, module: activeModule, procedure: proc.key, name: `${getModuleMeta(activeModule)?.label} - ${proc.label}` })); setShowNewWf(true); }}
                          className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-all">+ Add</button>
                    }
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workflow Cards */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Defined Workflows ({workflows.length})
            </p>
            {loading ? (
              <div className="text-slate-500 text-sm py-8 text-center animate-pulse">Loading...</div>
            ) : workflows.length === 0 ? (
              <div className="bg-slate-800/40 border border-dashed border-white/10 rounded-2xl p-8 text-center">
                <p className="text-slate-500 text-sm mb-2">No workflows defined for this module</p>
                <button onClick={() => setShowNewWf(true)} className="text-violet-400 text-sm hover:underline">Create one now</button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {workflows.map(wf => (
                  <div key={wf.id} onClick={() => handleSelectWf(wf)}
                    className={`bg-slate-800/50 border rounded-2xl p-4 cursor-pointer transition-all hover:border-violet-500/30 ${selectedWf?.id === wf.id ? 'border-violet-500/50 bg-violet-500/10' : 'border-white/10'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">{wf.name}</p>
                        <p className="text-slate-500 text-xs mt-0.5">{getProcLabel(wf.module, wf.procedure)}</p>
                        {wf.description && <p className="text-slate-600 text-xs mt-1 line-clamp-1">{wf.description}</p>}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-slate-400">{wf.stepCount} step{wf.stepCount !== 1 ? 's' : ''}</span>
                          {wf.activeInstances > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400 border border-amber-500/20">
                              {wf.activeInstances} live
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${wf.isActive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/40 text-slate-500 border-white/10'}`}>
                          {wf.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <div className="flex gap-1">
                          <button onClick={e => { e.stopPropagation(); handleToggleActive(wf); }}
                            className="px-2 py-0.5 text-xs rounded border border-white/10 text-slate-400 hover:bg-white/5 transition-all">
                            {wf.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleOpenEditWf(wf); }}
                            className="px-2 py-0.5 text-xs rounded border border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-all">Edit</button>
                          <button onClick={e => { e.stopPropagation(); handleDuplicate(wf); }}
                            className="px-2 py-0.5 text-xs rounded border border-blue-500/20 text-blue-400 hover:bg-blue-500/10 transition-all">Copy</button>
                          <button onClick={e => { e.stopPropagation(); handleDeleteWf(wf); }}
                            className="px-2 py-0.5 text-xs rounded border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 transition-all">Del</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Step Flow Designer */}
        <div className="lg:col-span-3">
          {!selectedWf ? (
            <div className="bg-slate-800/40 border border-dashed border-white/10 rounded-2xl p-12 text-center h-full flex flex-col items-center justify-center min-h-96">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4 text-3xl">W</div>
              <p className="text-white font-semibold mb-2">Select a Workflow to Design</p>
              <p className="text-slate-500 text-sm max-w-xs">Click any workflow on the left to configure its approval steps, assignees, SLA timers, and escalation rules</p>
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
              {/* Designer Header */}
              <div className="p-5 border-b border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r ${getModuleMeta(selectedWf.module)?.color ?? 'from-slate-500 to-slate-600'} text-white`}>
                        {selectedWf.module}
                      </span>
                      <span className="text-slate-500 text-xs">{getProcLabel(selectedWf.module, selectedWf.procedure)}</span>
                      {selectedWf.isActive
                        ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Active</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-400">Inactive</span>
                      }
                    </div>
                    <h2 className="text-white font-bold text-lg">{selectedWf.name}</h2>
                    {selectedWf.description && <p className="text-slate-500 text-xs mt-0.5">{selectedWf.description}</p>}
                  </div>
                  <button onClick={() => openStepEditor()}
                    className="flex-shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold text-sm hover:bg-violet-500 transition-all">
                    + Add Step
                  </button>
                </div>

                {/* Mini legend */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5">
                  {STEP_TYPES.map(t => (
                    <span key={t.value} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${t.color}`}>
                      {t.icon === 'CHECK' && <span>&#10003;</span>}
                      {t.icon === 'BELL'  && <span>&#9993;</span>}
                      {t.icon === 'AUTO'  && <span>&#10227;</span>}
                      {t.label}
                    </span>
                  ))}
                  <span className="text-slate-600 text-xs ml-auto">{wfSteps.length} step{wfSteps.length !== 1 ? 's' : ''} configured</span>
                </div>
              </div>

              {/* Step Flow */}
              <div className="p-5 max-h-[60vh] overflow-y-auto">
                {stepsLoading ? (
                  <div className="text-slate-500 text-sm animate-pulse py-10 text-center">Loading steps...</div>
                ) : wfSteps.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-slate-500 text-sm mb-4">No steps configured yet.</p>
                    <button onClick={() => openStepEditor()}
                      className="px-5 py-2.5 rounded-xl border border-dashed border-violet-500/40 text-violet-400 text-sm hover:bg-violet-500/10 transition-all">
                      + Add First Step
                    </button>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {/* Start */}
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-emerald-400 text-xs font-bold">S</span>
                      </div>
                      <div>
                        <span className="text-emerald-400 text-xs font-bold">TRIGGER / SUBMIT</span>
                        <p className="text-slate-600 text-xs">Workflow initiated by system or user action</p>
                      </div>
                    </div>

                    {wfSteps.map((step, idx) => {
                      const cond = parseCondition(step.conditionJson);
                      const sfx = STEP_TYPES.find(t => t.value === step.stepType);
                      return (
                        <React.Fragment key={step.id}>
                          {/* Connector line */}
                          <div className="flex items-stretch gap-3 py-0.5 ml-3.5">
                            <div className="w-0.5 bg-slate-700 self-stretch mx-[3px]" style={{ minHeight: 20 }} />
                          </div>
                          {/* Step card */}
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${sfx?.color ?? 'bg-slate-700 border-slate-600'}`}>
                              <StepIcon type={step.stepType} order={step.stepOrder} />
                            </div>
                            <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl p-3.5 hover:border-white/20 transition-all group">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStepTypeStyle(step.stepType)}`}>
                                      {STEP_TYPES.find(t => t.value === step.stepType)?.label ?? step.stepType}
                                    </span>
                                    {step.isOptional && <span className="text-xs text-slate-500 italic">optional</span>}
                                    {cond && (
                                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                        IF {cond.field} {cond.operator} {cond.value}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-white font-semibold text-sm">{step.stepName}</p>
                                  <div className="mt-1.5 space-y-0.5">
                                    {step.assigneeType === 'SPECIFIC_USER' && step.assigneeEmail && (
                                      <p className="text-xs text-slate-400"><span className="text-slate-600">Assignee:</span> {step.assigneeEmail}</p>
                                    )}
                                    {step.assigneeType === 'MULTI_USER' && step.multiApproverEmails && (
                                      <p className="text-xs text-slate-400"><span className="text-slate-600">Multiple:</span> {step.multiApproverEmails.split(',').length} approvers {step.requireAllApprovers ? '(all required)' : '(any one)'}</p>
                                    )}
                                    {!['SPECIFIC_USER','MULTI_USER'].includes(step.assigneeType) && (
                                      <p className="text-xs text-slate-400">
                                        <span className="text-slate-600">Route to:</span>{' '}
                                        {ASSIGNEE_TYPES.find(a => a.value === step.assigneeType)?.label}
                                        {step.assigneeRoleCode ? `  ${step.assigneeRoleCode}` : ''}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-3 text-xs text-slate-500">
                                      {step.slaHours > 0 && <span>SLA: {step.slaHours}h</span>}
                                      {step.escalationEmail && <span>Escalate to: {step.escalationEmail} (+{step.escalationHours}h)</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => moveStep(step, -1)} disabled={idx === 0}
                                    className="w-6 h-6 rounded bg-slate-700/60 text-slate-300 hover:bg-slate-600 disabled:opacity-30 text-xs flex items-center justify-center transition-all">^</button>
                                  <button onClick={() => moveStep(step, 1)} disabled={idx === wfSteps.length - 1}
                                    className="w-6 h-6 rounded bg-slate-700/60 text-slate-300 hover:bg-slate-600 disabled:opacity-30 text-xs flex items-center justify-center transition-all">v</button>
                                  <button onClick={() => openStepEditor(step)}
                                    className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs hover:bg-blue-500/30 transition-all">Edit</button>
                                  <button onClick={() => handleDeleteStep(step)}
                                    className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs hover:bg-rose-500/20 transition-all">Del</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}

                    {/* Connector + End */}
                    <div className="flex items-stretch gap-3 py-0.5 ml-3.5">
                      <div className="w-0.5 bg-slate-700 self-stretch mx-[3px]" style={{ minHeight: 20 }} />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-blue-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-400 text-xs font-bold">E</span>
                      </div>
                      <div>
                        <span className="text-blue-400 text-xs font-bold">WORKFLOW COMPLETE</span>
                        <p className="text-slate-600 text-xs">All steps approved  status updated, notifications sent</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/*  New Workflow Modal  */}
      {showNewWf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white">New Workflow Definition</h2>
                <p className="text-slate-400 text-xs mt-0.5">Define a reusable approval process for a procedure</p>
              </div>
              <button onClick={() => setShowNewWf(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all">x</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Workflow Name *</label>
                <input value={newWf.name} onChange={e => setNewWf(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Lease Quotation Internal Approval"
                  className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Module *</label>
                  <select value={newWf.module}
                    onChange={e => setNewWf(p => ({ ...p, module: e.target.value, procedure: PROCEDURES[e.target.value]?.[0]?.key ?? '' }))}
                    className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50">
                    {MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Procedure *</label>
                  <select value={newWf.procedure} onChange={e => setNewWf(p => ({ ...p, procedure: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50">
                    {getProcedures(newWf.module).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              {newWf.procedure && (
                <div className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
                  {getProcedures(newWf.module).find(p => p.key === newWf.procedure)?.description}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Description (optional)</label>
                <textarea value={newWf.description} onChange={e => setNewWf(p => ({ ...p, description: e.target.value }))}
                  placeholder="Internal notes about when and how this workflow is used..."
                  rows={2} className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none" />
              </div>
            </div>
            <div className="p-6 border-t border-white/10 flex gap-3 justify-end">
              <button onClick={() => setShowNewWf(false)} className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">Cancel</button>
              <button onClick={handleCreateWf} disabled={saving || !newWf.name || !newWf.module || !newWf.procedure}
                className="px-6 py-2.5 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-500 transition-all disabled:opacity-50 text-sm">
                {saving ? 'Creating...' : 'Create Workflow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  Step Editor Modal  */}
      {showStepEditor && editingStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
              <div>
                <h2 className="text-xl font-bold text-white">{editingStep.id ? 'Edit Step' : 'New Step'}</h2>
                <p className="text-slate-500 text-xs">Step {editingStep.stepOrder} of {selectedWf?.name}</p>
              </div>
              <button onClick={() => { setShowStepEditor(false); setEditingStep(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all">x</button>
            </div>

            {/* Step Editor Tabs */}
            <div className="flex gap-1 px-5 pt-4 border-b border-white/10">
              {([['basic','Basic Info'],['assignee','Assignee'],['email','Email Template'],['advanced','Conditions & SLA']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setStepTab(key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all -mb-px ${stepTab === key ? 'bg-slate-800 text-white border border-white/10 border-b-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="p-6 space-y-5">
              {/* Tab: Basic Info */}
              {stepTab === 'basic' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Step Name *</label>
                      <input value={editingStep.stepName ?? ''}
                        onChange={e => setEditingStep(p => ({ ...p!, stepName: e.target.value }))}
                        placeholder="e.g. Operations Manager Approval"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Step Order</label>
                      <input type="number" min="1" value={editingStep.stepOrder ?? 1}
                        onChange={e => setEditingStep(p => ({ ...p!, stepOrder: parseInt(e.target.value) || 1 }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Step Type *</label>
                    <div className="grid grid-cols-3 gap-3">
                      {STEP_TYPES.map(t => (
                        <label key={t.value} className={`flex flex-col gap-1 p-3 rounded-xl border cursor-pointer transition-all ${editingStep.stepType === t.value ? `${t.color}` : 'border-white/10 hover:border-white/20'}`}>
                          <div className="flex items-center gap-2">
                            <input type="radio" name="stepType" value={t.value} checked={editingStep.stepType === t.value}
                              onChange={e => setEditingStep(p => ({ ...p!, stepType: e.target.value }))} className="accent-violet-500" />
                            <span className="text-sm font-semibold text-white">{t.label}</span>
                          </div>
                          <p className="text-xs text-slate-500 pl-5">{t.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={editingStep.isOptional ?? false}
                      onChange={e => setEditingStep(p => ({ ...p!, isOptional: e.target.checked }))} className="w-4 h-4 accent-violet-500" />
                    <div>
                      <span className="text-slate-300 text-sm">Optional step</span>
                      <p className="text-slate-500 text-xs">Workflow continues even if this step is rejected or skipped</p>
                    </div>
                  </label>
                </div>
              )}

              {/* Tab: Assignee */}
              {stepTab === 'assignee' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Assignee Type *</label>
                    <div className="space-y-2">
                      {ASSIGNEE_TYPES.map(t => (
                        <label key={t.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${editingStep.assigneeType === t.value ? 'bg-violet-500/15 border-violet-500/40' : 'border-white/10 hover:border-white/20'}`}>
                          <input type="radio" name="assigneeType" value={t.value} checked={editingStep.assigneeType === t.value}
                            onChange={e => setEditingStep(p => ({ ...p!, assigneeType: e.target.value }))} className="accent-violet-500" />
                          <div>
                            <p className="text-white text-sm font-semibold">{t.label}</p>
                            <p className="text-slate-500 text-xs">{t.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  {editingStep.assigneeType === 'SPECIFIC_USER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Assignee Email *</label>
                      <input type="email" value={editingStep.assigneeEmail ?? ''}
                        onChange={e => setEditingStep(p => ({ ...p!, assigneeEmail: e.target.value }))}
                        placeholder="manager@company.com"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                  )}
                  {editingStep.assigneeType === 'ROLE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Role Code *</label>
                      <input value={editingStep.assigneeRoleCode ?? ''}
                        onChange={e => setEditingStep(p => ({ ...p!, assigneeRoleCode: e.target.value }))}
                        placeholder="e.g. LEASE_MANAGER, CREDIT_OFFICER, FINANCE_HEAD"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                  )}
                  {editingStep.assigneeType === 'MULTI_USER' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">Approver Emails (comma-separated)</label>
                        <textarea value={editingStep.multiApproverEmails ?? ''} rows={3}
                          onChange={e => setEditingStep(p => ({ ...p!, multiApproverEmails: e.target.value }))}
                          placeholder="manager1@co.com, manager2@co.com, cfo@co.com"
                          className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none" />
                      </div>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={editingStep.requireAllApprovers ?? false}
                          onChange={e => setEditingStep(p => ({ ...p!, requireAllApprovers: e.target.checked }))} className="w-4 h-4 accent-violet-500" />
                        <div>
                          <span className="text-slate-300 text-sm">Require ALL approvers</span>
                          <p className="text-slate-500 text-xs">If unchecked, any one of the listed approvers can approve</p>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Email Template */}
              {stepTab === 'email' && (
                <div className="space-y-4">
                  <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                    Available template variables: <code className="bg-blue-500/20 px-1 rounded">{'{referenceNumber}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{submittedBy}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{stepName}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{moduleLabel}'}</code>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email Subject</label>
                    <input value={editingStep.emailSubject ?? ''}
                      onChange={e => setEditingStep(p => ({ ...p!, emailSubject: e.target.value }))}
                      placeholder="Leave blank to use default: Action Required: {referenceNumber} awaiting approval"
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email Body</label>
                    <textarea value={editingStep.emailBody ?? ''} rows={6}
                      onChange={e => setEditingStep(p => ({ ...p!, emailBody: e.target.value }))}
                      placeholder={'Leave blank to use the default message.\n\nExample:\nDear {approverName},\n\nPlease review {referenceNumber} and take action.\n\nSubmitted by: {submittedBy}'}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none font-mono" />
                  </div>
                </div>
              )}

              {/* Tab: Conditions & SLA */}
              {stepTab === 'advanced' && (
                <div className="space-y-5">
                  {/* SLA */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">SLA (hours to respond)</label>
                      <input type="number" min="1" value={editingStep.slaHours ?? 24}
                        onChange={e => setEditingStep(p => ({ ...p!, slaHours: parseInt(e.target.value) || 24 }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50" />
                      <p className="text-slate-600 text-xs mt-1">Step becomes overdue after this many hours</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Escalation after (hours)</label>
                      <input type="number" min="1" value={editingStep.escalationHours ?? 48}
                        onChange={e => setEditingStep(p => ({ ...p!, escalationHours: parseInt(e.target.value) || 48 }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50" />
                      <p className="text-slate-600 text-xs mt-1">Hours before escalating to backup approver</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Escalation Email</label>
                    <input type="email" value={editingStep.escalationEmail ?? ''}
                      onChange={e => setEditingStep(p => ({ ...p!, escalationEmail: e.target.value }))}
                      placeholder="escalation@company.com (leave blank to skip escalation)"
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                  </div>

                  {/* Condition */}
                  <div className="border-t border-white/10 pt-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Conditional Step</p>
                        <p className="text-slate-600 text-xs">Only activate this step if a condition is met</p>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showCondition}
                          onChange={e => setShowCondition(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                        <span className="text-slate-300 text-sm">Enable condition</span>
                      </label>
                    </div>
                    {showCondition && (
                      <div className="space-y-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                        <p className="text-amber-400 text-xs font-semibold">ACTIVATE STEP ONLY IF...</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Field</label>
                            <select value={condField} onChange={e => setCondField(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50">
                              <option value="">Select field...</option>
                              {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Operator</label>
                            <select value={condOp} onChange={e => setCondOp(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50">
                              {CONDITION_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Value</label>
                            <input value={condVal} onChange={e => setCondVal(e.target.value)} placeholder="e.g. 100000"
                              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/50" />
                          </div>
                        </div>
                        {condField && condVal && (
                          <p className="text-amber-400/80 text-xs">
                            This step will only be activated if <strong>{CONDITION_FIELDS.find(f => f.value === condField)?.label}</strong> is <strong>{CONDITION_OPERATORS.find(o => o.value === condOp)?.label.toLowerCase()}</strong> <strong>{condVal}</strong>.
                            Otherwise the step is automatically skipped.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-white/10 flex gap-3 justify-between sticky bottom-0 bg-slate-900">
              <div className="flex gap-2">
                {(['basic','assignee','email','advanced'] as const).map((tab, i) => (
                  <button key={tab} onClick={() => setStepTab(tab)}
                    className={`w-2 h-2 rounded-full transition-all ${stepTab === tab ? 'bg-violet-500' : 'bg-slate-600 hover:bg-slate-500'}`} />
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowStepEditor(false); setEditingStep(null); }}
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">Cancel</button>
                <button onClick={handleSaveStep} disabled={saving || !editingStep.stepName}
                  className="px-6 py-2.5 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-500 transition-all disabled:opacity-50 text-sm">
                  {saving ? 'Saving...' : editingStep.id ? 'Update Step' : 'Add Step'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  Edit Workflow Modal  */}
      {showEditWf && editingWf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
              <div>
                <h2 className="text-xl font-bold text-white">Edit Workflow</h2>
                <p className="text-slate-400 text-xs mt-0.5">{editingWf.name}</p>
              </div>
              <button onClick={() => { setShowEditWf(false); setEditingWf(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all">x</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-4 border-b border-white/10">
              {([
                ['basic',      'Basic Info'],
                ['assignee',   'Assignee'],
                ['email',      'Email Template'],
                ['conditions', 'Conditions & SLA'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setEditWfTab(key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all -mb-px ${editWfTab === key ? 'bg-slate-800 text-white border border-white/10 border-b-slate-900' : 'text-slate-500 hover:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="p-6 space-y-5">

              {/*  Tab: Basic Info  */}
              {editWfTab === 'basic' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Workflow Name *</label>
                    <input value={editWfForm.name}
                      onChange={e => setEditWfForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Module</label>
                      <select value={editWfForm.module}
                        onChange={e => setEditWfForm(p => ({ ...p, module: e.target.value, procedure: PROCEDURES[e.target.value]?.[0]?.key ?? p.procedure }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50">
                        {MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Procedure</label>
                      <select value={editWfForm.procedure}
                        onChange={e => setEditWfForm(p => ({ ...p, procedure: e.target.value }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500/50">
                        {(PROCEDURES[editWfForm.module] ?? []).map(proc => <option key={proc.key} value={proc.key}>{proc.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {editWfForm.procedure && (
                    <div className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
                      {(PROCEDURES[editWfForm.module] ?? []).find(p => p.key === editWfForm.procedure)?.description}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Description</label>
                    <textarea value={editWfForm.description}
                      onChange={e => setEditWfForm(p => ({ ...p, description: e.target.value }))}
                      rows={3} placeholder="Internal notes about when and how this workflow is used..."
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none" />
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-white/10">
                    <div>
                      <p className="text-white text-sm font-semibold">Active Status</p>
                      <p className="text-slate-500 text-xs">Only active workflows are triggered by the system</p>
                    </div>
                    <button onClick={() => setEditWfForm(p => ({ ...p, isActive: !p.isActive }))}
                      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${editWfForm.isActive ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editWfForm.isActive ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>
              )}

              {/*  Tab: Assignee  */}
              {editWfTab === 'assignee' && (
                <div className="space-y-5">
                  <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                    Set the <strong>default assignee</strong> for all new steps in this workflow. Individual steps can override this. Existing steps are not affected.
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Default Assignee Type</label>
                    <div className="space-y-2">
                      {ASSIGNEE_TYPES.map(t => (
                        <label key={t.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${editWfForm.defaultAssigneeType === t.value ? 'bg-violet-500/15 border-violet-500/40' : 'border-white/10 hover:border-white/20'}`}>
                          <input type="radio" name="editWfAssignee" value={t.value}
                            checked={editWfForm.defaultAssigneeType === t.value}
                            onChange={e => setEditWfForm(p => ({ ...p, defaultAssigneeType: e.target.value }))}
                            className="accent-violet-500" />
                          <div>
                            <p className="text-white text-sm font-semibold">{t.label}</p>
                            <p className="text-slate-500 text-xs">{t.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  {editWfForm.defaultAssigneeType === 'SPECIFIC_USER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Assignee Email</label>
                      <input type="email" value={editWfForm.defaultAssigneeEmail}
                        onChange={e => setEditWfForm(p => ({ ...p, defaultAssigneeEmail: e.target.value }))}
                        placeholder="approver@company.com"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                  )}
                  {editWfForm.defaultAssigneeType === 'ROLE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Role Code</label>
                      <input value={editWfForm.defaultAssigneeRoleCode}
                        onChange={e => setEditWfForm(p => ({ ...p, defaultAssigneeRoleCode: e.target.value }))}
                        placeholder="e.g. LEASE_MANAGER, CREDIT_OFFICER, FINANCE_HEAD"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                    </div>
                  )}
                </div>
              )}

              {/*  Tab: Email Template  */}
              {editWfTab === 'email' && (
                <div className="space-y-4">
                  <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                    This is the <strong>workflow-level default</strong> email template. Steps that have no custom template will use this. Leave blank to use the system default.
                    <br /><br />
                    Available variables: <code className="bg-blue-500/20 px-1 rounded">{'{referenceNumber}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{submittedBy}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{stepName}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{moduleLabel}'}</code> <code className="bg-blue-500/20 px-1 rounded">{'{approvalUrl}'}</code>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Email Subject</label>
                    <input value={editWfForm.defaultEmailSubject}
                      onChange={e => setEditWfForm(p => ({ ...p, defaultEmailSubject: e.target.value }))}
                      placeholder="Action Required: {referenceNumber} is awaiting your approval"
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Email Body</label>
                    <textarea value={editWfForm.defaultEmailBody}
                      onChange={e => setEditWfForm(p => ({ ...p, defaultEmailBody: e.target.value }))}
                      rows={8}
                      placeholder={'Dear Approver,\n\nA new request {referenceNumber} has been submitted and requires your approval.\n\nStep: {stepName}\nSubmitted by: {submittedBy}\n\nPlease click the link below to review and take action.\n\n{approvalUrl}\n\nRegards,\nFleet360'}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50 resize-none font-mono leading-relaxed" />
                  </div>
                  {editWfForm.defaultEmailSubject || editWfForm.defaultEmailBody ? (
                    <div className="p-4 rounded-xl bg-slate-800/60 border border-white/10">
                      <p className="text-xs font-semibold text-slate-400 mb-2">Preview</p>
                      <p className="text-white text-sm font-semibold mb-2">
                        {editWfForm.defaultEmailSubject || 'Action Required: QT-001 is awaiting your approval'}
                      </p>
                      <p className="text-slate-400 text-xs whitespace-pre-wrap leading-relaxed">
                        {(editWfForm.defaultEmailBody || '').replace('{referenceNumber}','QT-001').replace('{submittedBy}','admin@company.com').replace('{stepName}','Manager Approval').replace('{moduleLabel}','Leasing').replace('{approvalUrl}','http://localhost:3000/approvals')}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {/*  Tab: Conditions & SLA  */}
              {editWfTab === 'conditions' && (
                <div className="space-y-5">
                  <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                    Set <strong>workflow-level defaults</strong> for SLA and escalation. Individual steps can override these values.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default SLA (hours)</label>
                      <input type="number" min="1" value={editWfForm.defaultSlaHours}
                        onChange={e => setEditWfForm(p => ({ ...p, defaultSlaHours: parseInt(e.target.value) || 24 }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50" />
                      <p className="text-slate-600 text-xs mt-1">Steps become overdue after this many hours</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Escalation (hours after SLA)</label>
                      <input type="number" min="1" value={editWfForm.defaultEscalationHours}
                        onChange={e => setEditWfForm(p => ({ ...p, defaultEscalationHours: parseInt(e.target.value) || 48 }))}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50" />
                      <p className="text-slate-600 text-xs mt-1">Hours before escalating to the backup approver</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Default Escalation Email</label>
                    <input type="email" value={editWfForm.defaultEscalationEmail}
                      onChange={e => setEditWfForm(p => ({ ...p, defaultEscalationEmail: e.target.value }))}
                      placeholder="manager@company.com  leave blank to skip escalation"
                      className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/50" />
                  </div>
                  <div className="border-t border-white/10 pt-5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">SLA Summary</p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      {[
                        { label: 'Pending', hours: editWfForm.defaultSlaHours, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
                        { label: 'Overdue', hours: editWfForm.defaultSlaHours, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
                        { label: 'Escalated', hours: editWfForm.defaultSlaHours + editWfForm.defaultEscalationHours, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
                      ].map(s => (
                        <div key={s.label} className={`rounded-xl p-3 border ${s.bg}`}>
                          <p className={`text-lg font-bold ${s.color}`}>{s.hours}h</p>
                          <p className="text-slate-500 text-xs">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="p-5 border-t border-white/10 flex items-center justify-between sticky bottom-0 bg-slate-900">
              <div className="flex gap-1.5">
                {(['basic','assignee','email','conditions'] as const).map(tab => (
                  <button key={tab} onClick={() => setEditWfTab(tab)}
                    className={`w-2 h-2 rounded-full transition-all ${editWfTab === tab ? 'bg-amber-400' : 'bg-slate-600 hover:bg-slate-500'}`} />
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowEditWf(false); setEditingWf(null); }}
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm">Cancel</button>
                <button onClick={handleSaveEditWf} disabled={saving || !editWfForm.name}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-400 transition-all disabled:opacity-50 text-sm">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
