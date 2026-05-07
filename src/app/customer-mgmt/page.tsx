'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

//  Types 
interface HNode { id: string; name: string; code?: string; level: string; }
interface Customer {
  id: string; customerCode?: string; customerType: string; priority?: string;
  accountCode?: string; tradeLicense?: string; nameEn: string; nameAr?: string;
  email?: string; mobileNumber?: string; mobileCountryCode?: string;
  communicationLanguage?: string; descriptionEn?: string;
  regionId?: string; departmentId?: string; unitId?: string;
  region?: HNode; department?: HNode; unit?: HNode;
  contactPerson?: string; contactPersonPhone?: string; contactPersonEmail?: string;
  addressLine1?: string; addressLine2?: string; city?: string; state?: string;
  country?: string; poBox?: string;
  taxRegistrationNumber?: string; taxApplicable?: boolean; tollExempt?: boolean;
  creditLimit?: number; creditDays?: number; allowedPaymentMethods?: string;
  defaultPaymentMethod?: string; billingCycle?: string; invoiceFrequency?: string;
  invoiceDeliveryMethod?: string; paymentReminderDays?: number;
  lateFeePercentage?: number; autoInvoice?: boolean;
  allowedWaitingTimeMin?: number; cancellationAllowedMin?: number;
  allowedBookingModifications?: number; skipApproval?: boolean;
  preferredChannel?: string; notificationEmail?: string;
  notificationSmsCode?: string; notificationSms?: string;
  marketingCommunications?: boolean; bookingNotifications?: boolean;
  status?: string;
}
interface Stats { total:number; active:number; inactive:number; walkIn:number; vip:number; }
type ModalTab = 'basic'|'contact'|'financial'|'booking'|'attachments';

const CUSTOMER_TYPES = ['INTERNAL','CORPORATE','INDIVIDUAL','WALK_IN','VIP'];
const PRIORITIES     = ['LOW','MEDIUM','HIGH','VIP'];
const PAYMENT_METHODS = ['CASH','CREDIT_CARD','DEBIT_CARD','BANK_TRANSFER','CHEQUE','DIRECT_DEBIT','ONLINE'];
const BILLING_CYCLES  = ['MONTHLY','QUARTERLY','SEMI_ANNUALLY','ANNUALLY'];
const INVOICE_FREQ    = ['WEEKLY','BI_WEEKLY','MONTHLY','QUARTERLY'];
const DELIVERY_METHODS = ['EMAIL','PRINT','PORTAL','WHATSAPP'];
const CHANNELS = ['EMAIL','SMS','WHATSAPP','APP','PORTAL'];

const TYPE_COLORS: Record<string,string> = {
  INTERNAL:   'bg-slate-500/20 text-slate-300 border-slate-500/30',
  CORPORATE:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  INDIVIDUAL: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  WALK_IN:    'bg-amber-500/20 text-amber-400 border-amber-500/30',
  VIP:        'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
};
const TYPE_ACCENT: Record<string,string> = {
  INTERNAL:'from-slate-500 to-slate-600', CORPORATE:'from-blue-600 to-indigo-600',
  INDIVIDUAL:'from-violet-600 to-purple-600', WALK_IN:'from-amber-600 to-orange-600',
  VIP:'from-yellow-500 to-amber-600',
};

const emptyForm = (): Partial<Customer> => ({
  customerType:'CORPORATE', priority:'MEDIUM', country:'UAE',
  mobileCountryCode:'+971', communicationLanguage:'en',
  taxApplicable:true, tollExempt:false, autoInvoice:false,
  skipApproval:false, bookingNotifications:true,
  marketingCommunications:false, notificationSmsCode:'+971', status:'ACTIVE',
});

// Shared input styles matching app dark theme
const inp = "w-full px-3 py-2.5 rounded-xl bg-slate-700/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-cyan-500 focus:outline-none transition-colors";
const sel = "w-full px-3 py-2.5 rounded-xl bg-slate-700/50 border border-white/10 text-white text-sm focus:border-cyan-500 focus:outline-none transition-colors";
const lbl = "block text-sm font-medium text-slate-300 mb-1.5";
const sublbl = "text-xs text-slate-500 mt-1";

const Fld = ({ label, help, req, children }: { label:string; help?:string; req?:boolean; children:React.ReactNode }) => (
  <div>
    <label className={lbl}>{label}{req && <span className="text-rose-400 ml-0.5">*</span>}</label>
    {children}
    {help && <p className={sublbl}>{help}</p>}
  </div>
);

const Section = ({ title, children }: { title:string; children:React.ReactNode }) => (
  <div className="space-y-4">
    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
      <span className="flex-1 h-px bg-white/10" />
      {title}
      <span className="flex-1 h-px bg-white/10" />
    </h3>
    {children}
  </div>
);

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v:boolean)=>void }) => (
  <button type="button" onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-cyan-600' : 'bg-slate-600'}`}>
    <span className={`inline-block h-3 w-3 mt-1 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
);

//  Main Page 
export default function CustomerPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats>({ total:0, active:0, inactive:0, walkIn:0, vip:0 });
  const [regions, setRegions]   = useState<HNode[]>([]);
  const [depts, setDepts]       = useState<HNode[]>([]);
  const [units, setUnits]       = useState<HNode[]>([]);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer|null>(null);
  const [activeTab, setActiveTab]   = useState<ModalTab>('basic');
  const [form, setForm]             = useState<Partial<Customer>>(emptyForm());
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [documents, setDocuments]       = useState<any[]>([]);
  const [docForm, setDocForm]           = useState({ docName:'', docType:'TRADE_LICENSE', fileUrl:'', notes:'' });
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search)     p.set('search', search);
      if (typeFilter) p.set('customerType', typeFilter);
      const [cRes, sRes, rRes] = await Promise.all([
        fetch(`/api/customers?${p}`),
        fetch('/api/customers/stats'),
        fetch('/api/customer-hierarchy?level=REGION'),
      ]);
      const [cData, sData, rData] = await Promise.all([cRes.json(), sRes.json(), rRes.json()]);
      setCustomers(Array.isArray(cData) ? cData : []);
      if (sData && !sData.error) setStats(sData);
      setRegions(Array.isArray(rData) ? rData : []);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }, [search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const loadDepts = async (rid: string) => {
    const d = await fetch(`/api/customer-hierarchy?level=DEPARTMENT&parentId=${rid}`).then(r=>r.json());
    setDepts(Array.isArray(d)?d:[]); setUnits([]);
  };
  const loadUnits = async (did: string) => {
    const d = await fetch(`/api/customer-hierarchy?level=UNIT&parentId=${did}`).then(r=>r.json());
    setUnits(Array.isArray(d)?d:[]);
  };

  const openNew = () => {
    setEditCustomer(null); setForm(emptyForm()); setActiveTab('basic');
    setDepts([]); setUnits([]); setDocuments([]); setDocForm({ docName:'', docType:'TRADE_LICENSE', fileUrl:'', notes:'' });
    setError(''); setShowModal(true);
  };
  const loadDocuments = async (customerId: string) => {
    try {
      const res = await fetch(`/api/customers/${customerId}/documents`);
      const d   = await res.json();
      setDocuments(Array.isArray(d) ? d : []);
    } catch { setDocuments([]); }
  };

  const openEdit = async (c: Customer) => {
    setEditCustomer(c); setForm({...c}); setActiveTab('basic'); setError('');
    if (c.regionId)     await loadDepts(c.regionId);
    if (c.departmentId) await loadUnits(c.departmentId);
    await loadDocuments(c.id);
    setShowModal(true);
  };
  const set = (k: keyof Customer, v: any) => setForm(p => ({...p, [k]: v}));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nameEn?.trim()) { setError('Customer name (English) is required'); setActiveTab('basic'); return; }
    setSaving(true); setError('');
    try {
      const url    = editCustomer ? `/api/customers/${editCustomer.id}` : '/api/customers';
      const method = editCustomer ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e:any) { setError(e.message ?? 'Failed'); } finally { setSaving(false); }
  };

  const deleteCustomer = async (id:string) => {
    if (!confirm('Deactivate this customer?')) return;
    await fetch(`/api/customers/${id}`,{ method:'DELETE' }); load();
  };

  const displayed = customers.filter(c => showInactive || c.status !== 'INACTIVE');

  const STAT_CARDS = [
    { label:'TOTAL',    value:stats.total,    color:'bg-blue-600',    textColor:'text-white', icon:'T' },
    { label:'ACTIVE',   value:stats.active,   color:'bg-emerald-600', textColor:'text-white', icon:'A' },
    { label:'INACTIVE', value:stats.inactive, color:'bg-rose-600',    textColor:'text-white', icon:'I' },
    { label:'WALK-IN',  value:stats.walkIn,   color:'bg-cyan-600',    textColor:'text-white', icon:'W' },
    { label:'VIP',      value:stats.vip,      color:'bg-yellow-500',  textColor:'text-slate-900', icon:'V' },
  ];

  const TABS: {id:ModalTab; label:string}[] = [
    {id:'basic',       label:'Basic Info'},
    {id:'contact',     label:'Contact & Address'},
    {id:'financial',   label:'Financial & Billing'},
    {id:'booking',     label:'Booking & Communication'},
    {id:'attachments', label:'Attachments'},
  ];

  const accent = TYPE_ACCENT[form.customerType ?? 'CORPORATE'];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Customer Management"
        subtitle="Manage customers with Region → Department → Unit hierarchy"
        icon={Building2}
        accent="cyan"
        actions={
          <button onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-cyan-500/30">
            <Plus className="w-4 h-4" /> New customer
          </button>
        }
      />

      {/* Stats */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Customers Statistics</p>
        <div className="grid grid-cols-5 gap-3">
          {STAT_CARDS.map(s => (
            <button key={s.label} onClick={() => setTypeFilter(s.label === 'WALK-IN' ? 'WALK_IN' : s.label === 'TOTAL' || s.label === 'ACTIVE' || s.label === 'INACTIVE' ? '' : s.label)}
              className={`${s.color} rounded-2xl p-5 text-left hover:opacity-90 transition-all`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold tracking-wider ${s.textColor} opacity-80`}>{s.label}</span>
                <div className={`w-7 h-7 rounded-full bg-black/20 flex items-center justify-center ${s.textColor} text-xs font-bold`}>{s.icon}</div>
              </div>
              <div className={`text-4xl font-bold ${s.textColor}`}>{s.value}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-white/10 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <Toggle checked={showInactive} onChange={setShowInactive} />
            Show Inactive
          </label>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers..."
            className="flex-1 min-w-48 px-3 py-1.5 rounded-lg bg-slate-700 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-700 border border-white/10 text-white text-sm focus:outline-none">
            <option value="">All Types</option>
            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{(t || '').replace('_',' ')}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-16 animate-pulse">Loading customers...</div>
        ) : displayed.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            <p className="text-lg mb-2">No customers found</p>
            <p className="text-sm">Click &quot;+ New Customer&quot; to add one, or run the Leasing seed data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-white/5 bg-slate-800/50">
                  <th className="px-4 py-3 text-left"><input type="checkbox" className="accent-cyan-500" /></th>
                  {['CODE','CUSTOMER NAME','TYPE','EMAIL','MOBILE','CONTACT PERSON','HIERARCHY','STATUS','ACTIONS'].map(h=>(
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(c=>(
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3"><input type="checkbox" className="accent-cyan-500" /></td>
                    <td className="px-3 py-3 text-xs font-mono text-cyan-400 whitespace-nowrap">{c.customerCode??'-'}</td>
                    <td className="px-3 py-3 text-sm font-medium text-white whitespace-nowrap">{c.nameEn}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${TYPE_COLORS[c.customerType]??TYPE_COLORS.CORPORATE}`}>
                        {(c.customerType || '').replace('_',' ')}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white max-w-[140px] truncate">{c.email??'-'}</td>
                    <td className="px-3 py-3 text-white whitespace-nowrap">{c.mobileCountryCode} {c.mobileNumber??'-'}</td>
                    <td className="px-3 py-3 text-slate-200">{c.contactPerson??'-'}</td>
                    <td className="px-3 py-3 text-xs">
                      <div className="text-slate-200">{c.region?.name??'-'}</div>
                      {c.department&&<div className="text-slate-500">{c.department.name}</div>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.status==='ACTIVE'?'bg-emerald-500/20 text-emerald-400':'bg-slate-600 text-slate-400'}`}>{c.status??'ACTIVE'}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex gap-1.5">
                        <button onClick={()=>openEdit(c)} className="px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs hover:bg-blue-500/30">Edit</button>
                        <button onClick={()=>deleteCustomer(c.id)} className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs hover:bg-rose-500/30">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs text-slate-500">
          <span>Showing {displayed.length} of {customers.length} customers</span>
          <span>{stats.active} active  {stats.inactive} inactive</span>
        </div>
      </div>

      {/* 
          CUSTOMER MODAL - Dark Slate Theme matching app design
       */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border-l border-white/10 w-full max-w-2xl h-full flex flex-col shadow-2xl">

            {/* Modal Header */}
            <div className={`flex items-center justify-between px-6 py-4 bg-gradient-to-r ${accent} flex-shrink-0`}>
              <div>
                <h2 className="text-xl font-bold text-white">{editCustomer ? 'Edit Customer' : 'Create New Customer'}</h2>
                <p className="text-white/70 text-sm mt-0.5">
                  {editCustomer ? `Updating ${editCustomer.nameEn}` : 'Configure a new customer with modules and settings'}
                </p>
              </div>
              <button onClick={()=>setShowModal(false)} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all text-xl leading-none">&times;</button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-white/10 bg-slate-800/80 flex-shrink-0 overflow-x-auto">
              {TABS.map(t => (
                <button key={t.id} type="button" onClick={()=>setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-all flex-shrink-0 ${activeTab===t.id?'border-cyan-500 text-cyan-400 bg-cyan-500/5':'border-transparent text-slate-400 hover:text-slate-300'}`}>
                  {t.label}
                  {activeTab===t.id&&<span className="w-1.5 h-1.5 rounded-full bg-cyan-400"/>}
                </button>
              ))}
            </div>

            {error && (
              <div className="mx-6 mt-4 px-4 py-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm flex-shrink-0">{error}</div>
            )}

            {/* Scrollable Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

                {/*  BASIC INFO  */}
                {activeTab==='basic'&&(
                  <div className="space-y-6">
                    <Section title="Customer Identification">
                      <div className="grid grid-cols-3 gap-4">
                        <Fld label="Customer Code" help="Unique identifier (auto-generated if blank)">
                          <input className={inp} value={form.customerCode??''} onChange={e=>set('customerCode',e.target.value)} placeholder="e.g., CORP0001"/>
                        </Fld>
                        <Fld label="Customer Type" req>
                          <select className={sel} value={form.customerType??'CORPORATE'} onChange={e=>set('customerType',e.target.value)}>
                            {CUSTOMER_TYPES.map(t=><option key={t} value={t}>{(t || '').replace('_',' ')}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Priority">
                          <select className={sel} value={form.priority??''} onChange={e=>set('priority',e.target.value)}>
                            <option value="">Select priority</option>
                            {PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Region (Hierarchy Level 1)">
                          <select className={sel} value={form.regionId??''} onChange={async e=>{set('regionId',e.target.value);set('departmentId','');set('unitId','');if(e.target.value)await loadDepts(e.target.value);else setDepts([]);}}>
                            <option value="">Select region</option>
                            {regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </Fld>
                        {depts.length>0&&(
                          <Fld label="Department (Level 2)">
                            <select className={sel} value={form.departmentId??''} onChange={async e=>{set('departmentId',e.target.value);set('unitId','');if(e.target.value)await loadUnits(e.target.value);else setUnits([]);}}>
                              <option value="">Select department</option>
                              {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          </Fld>
                        )}
                        {units.length>0&&(
                          <Fld label="Unit (Level 3)">
                            <select className={sel} value={form.unitId??''} onChange={e=>set('unitId',e.target.value)}>
                              <option value="">Select unit</option>
                              {units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </Fld>
                        )}
                        <Fld label="Account Code" help="Accounting reference code">
                          <input className={inp} value={form.accountCode??''} onChange={e=>set('accountCode',e.target.value)} placeholder="e.g., ACC-001"/>
                        </Fld>
                        <Fld label="Trade License" help="Business registration/license number">
                          <input className={inp} value={form.tradeLicense??''} onChange={e=>set('tradeLicense',e.target.value)} placeholder="TL-XXXXXX"/>
                        </Fld>
                      </div>
                    </Section>

                    <Section title="Contact Details">
                      <div className="grid grid-cols-3 gap-4">
                        <Fld label="Email ID">
                          <input type="email" className={inp} value={form.email??''} onChange={e=>set('email',e.target.value)} placeholder="Enter email address"/>
                        </Fld>
                        <Fld label="Mobile Number" req>
                          <div className="flex gap-2">
                            <select className="w-24 px-2 py-2.5 rounded-xl bg-slate-700/50 border border-white/10 text-white text-sm focus:outline-none" value={form.mobileCountryCode??'+971'} onChange={e=>set('mobileCountryCode',e.target.value)}>
                              {['+971','+966','+965','+973','+968','+974','+91','+1','+44'].map(c=><option key={c} value={c}>{c}</option>)}
                            </select>
                            <input className={`${inp} flex-1`} value={form.mobileNumber??''} onChange={e=>set('mobileNumber',e.target.value)} placeholder="Phone number"/>
                          </div>
                        </Fld>
                        <Fld label="Communication Language">
                          <select className={sel} value={form.communicationLanguage??'en'} onChange={e=>set('communicationLanguage',e.target.value)}>
                            <option value="en">English</option>
                            <option value="ar">Arabic</option>
                            <option value="fr">French</option>
                          </select>
                        </Fld>
                      </div>
                    </Section>

                    <Section title="Localised Tenant Information">
                      <p className="text-xs text-slate-500 -mt-2">Enter the customer name and description in all supported languages</p>
                      <div className="grid grid-cols-2 gap-4">
                        <Fld label="Customer Name (English)" req>
                          <input className={inp} value={form.nameEn??''} onChange={e=>set('nameEn',e.target.value)} required placeholder="Enter customer name (English)"/>
                        </Fld>
                        <Fld label="Description (English)">
                          <input className={inp} value={form.descriptionEn??''} onChange={e=>set('descriptionEn',e.target.value)} placeholder="Short description (English)"/>
                        </Fld>
                        {form.communicationLanguage==='ar'&&<>
                          <Fld label="Customer Name (Arabic)">
                            <input className={inp} dir="rtl" value={form.nameAr??''} onChange={e=>set('nameAr',e.target.value)} placeholder=" "/>
                          </Fld>
                        </>}
                      </div>
                    </Section>
                  </div>
                )}

                {/*  CONTACT & ADDRESS  */}
                {activeTab==='contact'&&(
                  <div className="space-y-6">
                    <Section title="Contact Person">
                      <div className="grid grid-cols-3 gap-4">
                        {[{l:'Contact Person Name',k:'contactPerson',ph:'Full name'},{l:'Contact Phone',k:'contactPersonPhone',ph:'+971 XX XXX XXXX'},{l:'Contact Email',k:'contactPersonEmail',ph:'contact@company.com'}].map(({l,k,ph})=>(
                          <Fld key={k} label={l}><input className={inp} value={(form as any)[k]??''} onChange={e=>set(k as keyof Customer,e.target.value)} placeholder={ph}/></Fld>
                        ))}
                      </div>
                    </Section>
                    <Section title="Address">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2"><Fld label="Address Line 1"><input className={inp} value={form.addressLine1??''} onChange={e=>set('addressLine1',e.target.value)} placeholder="Street address, building name"/></Fld></div>
                        <div className="col-span-2"><Fld label="Address Line 2"><input className={inp} value={form.addressLine2??''} onChange={e=>set('addressLine2',e.target.value)} placeholder="Floor, apartment, suite"/></Fld></div>
                        {[{l:'City',k:'city',ph:'Dubai'},{l:'State / Emirate',k:'state',ph:'Dubai'},{l:'Country',k:'country',ph:'UAE'},{l:'P.O. Box',k:'poBox',ph:'123456'}].map(({l,k,ph})=>(
                          <Fld key={k} label={l}><input className={inp} value={(form as any)[k]??''} onChange={e=>set(k as keyof Customer,e.target.value)} placeholder={ph}/></Fld>
                        ))}
                      </div>
                    </Section>
                  </div>
                )}

                {/*  FINANCIAL & BILLING  */}
                {activeTab==='financial'&&(
                  <div className="space-y-6">
                    <Section title="Tax Information">
                      <div className="grid grid-cols-2 gap-4">
                        <Fld label="Tax Registration Number (TRN)" help="15-digit Tax Registration Number">
                          <input className={inp} value={form.taxRegistrationNumber??''} onChange={e=>set('taxRegistrationNumber',e.target.value)} placeholder="e.g., 100123456789015"/>
                        </Fld>
                        <div className="flex items-center gap-6 pt-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Toggle checked={form.taxApplicable??true} onChange={v=>set('taxApplicable',v)}/>
                            <span className="text-sm text-slate-300">Tax Applicable</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Toggle checked={form.tollExempt??false} onChange={v=>set('tollExempt',v)}/>
                            <span className="text-sm text-slate-300">Toll Exempt</span>
                          </label>
                        </div>
                      </div>
                    </Section>
                    <Section title="Credit Management">
                      <div className="grid grid-cols-2 gap-4">
                        <Fld label="Credit Limit (AED)" help="Maximum credit amount allowed">
                          <input type="number" min="0" className={inp} value={form.creditLimit??''} onChange={e=>set('creditLimit',parseFloat(e.target.value)||0)} placeholder="e.g., 50000"/>
                        </Fld>
                        <Fld label="Credit Days" help="Payment due period">
                          <input type="number" min="0" className={inp} value={form.creditDays??''} onChange={e=>set('creditDays',parseInt(e.target.value)||0)} placeholder="e.g., 30"/>
                        </Fld>
                      </div>
                    </Section>
                    <Section title="Payment Settings">
                      <div className="grid grid-cols-2 gap-4">
                        <Fld label="Allowed Payment Methods" help="Click to select multiple">
                          <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-slate-700/50 border border-white/10 min-h-[48px]">
                            {PAYMENT_METHODS.map(m=>{
                              const cur=form.allowedPaymentMethods?JSON.parse(form.allowedPaymentMethods):[];
                              const sel=cur.includes(m);
                              return(<button type="button" key={m} onClick={()=>{
                                const upd=sel?cur.filter((x:string)=>x!==m):[...cur,m];
                                set('allowedPaymentMethods',JSON.stringify(upd));
                              }} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${sel?'bg-cyan-600 text-white':'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}>{ (m || '').replace('_',' ') }</button>);
                            })}
                          </div>
                        </Fld>
                        <Fld label="Default Payment Method">
                          <select className={sel} value={form.defaultPaymentMethod??''} onChange={e=>set('defaultPaymentMethod',e.target.value)}>
                            <option value="">Select default method</option>
                            {PAYMENT_METHODS.map(m=><option key={m} value={m}>{(m || '').replace('_',' ')}</option>)}
                          </select>
                        </Fld>
                      </div>
                    </Section>
                    <Section title="Billing & Invoicing">
                      <div className="grid grid-cols-3 gap-4">
                        <Fld label="Billing Cycle">
                          <select className={sel} value={form.billingCycle??''} onChange={e=>set('billingCycle',e.target.value)}>
                            <option value="">Select cycle</option>
                            {BILLING_CYCLES.map(b=><option key={b} value={b}>{b}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Invoice Frequency">
                          <select className={sel} value={form.invoiceFrequency??''} onChange={e=>set('invoiceFrequency',e.target.value)}>
                            <option value="">Select frequency</option>
                            {INVOICE_FREQ.map(f=><option key={f} value={f}>{f}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Invoice Delivery Method">
                          <select className={sel} value={form.invoiceDeliveryMethod??''} onChange={e=>set('invoiceDeliveryMethod',e.target.value)}>
                            <option value="">Select method</option>
                            {DELIVERY_METHODS.map(d=><option key={d} value={d}>{d}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Payment Reminder Days" help="Days before due date to send reminder">
                          <input type="number" min="0" className={inp} value={form.paymentReminderDays??''} onChange={e=>set('paymentReminderDays',parseInt(e.target.value)||0)} placeholder="e.g., 7"/>
                        </Fld>
                        <Fld label="Late Fee %" help="Percentage charged on overdue payments">
                          <input type="number" min="0" step="0.01" className={inp} value={form.lateFeePercentage??''} onChange={e=>set('lateFeePercentage',parseFloat(e.target.value)||0)} placeholder="e.g., 2.5"/>
                        </Fld>
                        <div className="flex items-center gap-3 pt-6">
                          <Toggle checked={form.autoInvoice??false} onChange={v=>set('autoInvoice',v)}/>
                          <span className="text-sm text-slate-300">Auto Invoice</span>
                        </div>
                      </div>
                    </Section>
                  </div>
                )}

                {/*  BOOKING & COMMUNICATION  */}
                {activeTab==='booking'&&(
                  <div className="space-y-6">
                    <Section title="Booking Preferences">
                      <div className="grid grid-cols-3 gap-4">
                        <Fld label="Allowed Waiting Time (min)" help="Free waiting time for the driver">
                          <input type="number" min="0" className={inp} value={form.allowedWaitingTimeMin??''} onChange={e=>set('allowedWaitingTimeMin',parseInt(e.target.value)||0)} placeholder="e.g., 10"/>
                        </Fld>
                        <Fld label="Cancellation Allowed (min)" help="Minutes before pickup to allow cancellation">
                          <input type="number" min="0" className={inp} value={form.cancellationAllowedMin??''} onChange={e=>set('cancellationAllowedMin',parseInt(e.target.value)||0)} placeholder="e.g., 30"/>
                        </Fld>
                        <Fld label="Allowed Booking Modifications" help="Number of times booking can be modified">
                          <input type="number" min="0" className={inp} value={form.allowedBookingModifications??''} onChange={e=>set('allowedBookingModifications',parseInt(e.target.value)||0)} placeholder="e.g., 3"/>
                        </Fld>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <Toggle checked={form.skipApproval??false} onChange={v=>set('skipApproval',v)}/>
                        <span className="text-sm text-slate-300">Skip Approval</span>
                      </div>
                    </Section>
                    <Section title="Communication Settings">
                      <div className="grid grid-cols-3 gap-4">
                        <Fld label="Preferred Channel">
                          <select className={sel} value={form.preferredChannel??''} onChange={e=>set('preferredChannel',e.target.value)}>
                            <option value="">Select channel</option>
                            {CHANNELS.map(c=><option key={c} value={c}>{c}</option>)}
                          </select>
                        </Fld>
                        <Fld label="Notification Email" help="Email for booking notifications">
                          <input type="email" className={inp} value={form.notificationEmail??''} onChange={e=>set('notificationEmail',e.target.value)} placeholder="Enter notification email"/>
                        </Fld>
                        <Fld label="Notification SMS">
                          <div className="flex gap-2">
                            <select className="w-24 px-2 py-2.5 rounded-xl bg-slate-700/50 border border-white/10 text-white text-sm focus:outline-none" value={form.notificationSmsCode??'+971'} onChange={e=>set('notificationSmsCode',e.target.value)}>
                              {['+971','+966','+91','+1','+44'].map(c=><option key={c} value={c}>{c}</option>)}
                            </select>
                            <input className={`${inp} flex-1`} value={form.notificationSms??''} onChange={e=>set('notificationSms',e.target.value)} placeholder="Phone number"/>
                          </div>
                        </Fld>
                      </div>
                      <div className="flex items-center gap-6 mt-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Toggle checked={form.marketingCommunications??false} onChange={v=>set('marketingCommunications',v)}/>
                          <span className="text-sm text-slate-300">Marketing Communications</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Toggle checked={form.bookingNotifications??true} onChange={v=>set('bookingNotifications',v)}/>
                          <span className="text-sm text-slate-300">Booking Notifications</span>
                        </label>
                      </div>
                    </Section>
                  </div>
                )}

                {/*  ATTACHMENTS  */}
                {activeTab==='attachments'&&(
                  <div className="space-y-4">
                    <Section title="Attachments">
                      {!editCustomer?(
                        <div className="flex flex-col items-center justify-center py-14 border-2 border-dashed border-white/10 rounded-2xl">
                          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-2xl text-slate-500 mb-3">P</div>
                          <p className="text-slate-400 text-sm">Attachments can be added after saving</p>
                          <p className="text-slate-600 text-xs mt-1">Save the customer first, then upload files</p>
                        </div>
                      ):(
                        <div className="border-2 border-dashed border-white/10 rounded-2xl p-8 text-center hover:border-cyan-500/30 transition-colors cursor-pointer">
                          <p className="text-slate-400 text-sm">Click to upload or drag and drop files here</p>
                          <p className="text-slate-600 text-xs mt-1">PDF, PNG, JPG, DOCX up to 10MB</p>
                        </div>
                      )}
                    </Section>
                  </div>
                )}

              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/10 bg-slate-800/50 flex items-center justify-between flex-shrink-0">
                <div className="flex gap-2">
                  {TABS.map((t,i)=>(
                    <button key={t.id} type="button" onClick={()=>setActiveTab(t.id)}
                      className={`w-2 h-2 rounded-full transition-all ${activeTab===t.id?'bg-cyan-500 w-6':'bg-slate-600'}`}/>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={()=>setShowModal(false)}
                    className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-sm">Cancel</button>
                  {activeTab!=='attachments'&&TABS.findIndex(t=>t.id===activeTab)<TABS.length-2&&(
                    <button type="button" onClick={()=>setActiveTab(TABS[TABS.findIndex(t=>t.id===activeTab)+1].id)}
                      className="px-5 py-2.5 rounded-xl bg-slate-700 text-white text-sm hover:bg-slate-600">Next &rarr;</button>
                  )}
                  <button type="submit" disabled={saving}
                    className={`px-6 py-2.5 rounded-xl bg-gradient-to-r ${accent} text-white font-medium text-sm hover:opacity-90 disabled:opacity-50`}>
                    {saving?'Saving...':(editCustomer?'Update Customer':'Create Customer')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
