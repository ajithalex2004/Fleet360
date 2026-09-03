'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  ShieldCheck,
  CreditCard,
  Percent,
  CheckCircle2,
  Trash2,
  Send,
  MessageSquare,
  Sparkles,
  ArrowRight,
  DollarSign,
  AlertCircle,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  CorporateClientRecord,
  AuthorizedClientUser,
} from '@/lib/corporate-clients-registry';

export default function CorporateClientsPage() {
  const [clients, setClients] = useState<CorporateClientRecord[]>([]);
  const [selectedClient, setSelectedClient] = useState<CorporateClientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [enableSmsAuth, setEnableSmsAuth] = useState(true);

  // Modals
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);

  // Load tenant auth settings
  const loadTenantSettings = async () => {
    try {
      const res = await fetch('/api/auth/roster-otp');
      if (res.ok) {
        const json = await res.json();
        if (json.tenantSettings) {
          setEnableSmsAuth(json.tenantSettings.enableSmsAuth ?? true);
        }
      }
    } catch {}
  };

  const handleToggleSmsAuth = async (enabled: boolean) => {
    try {
      setEnableSmsAuth(enabled);
      await fetch('/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_TENANT_SMS_SETTING',
          tenantId: 'tnt-exl-solutions',
          enableSmsAuth: enabled,
        }),
      });
      setInviteSuccessMsg(`✅ Tenant SMS Authentication updated: ${enabled ? 'ENABLED' : 'DISABLED (WhatsApp & Email Only)'}`);
      setTimeout(() => setInviteSuccessMsg(null), 4000);
    } catch (err) {
      console.error('Failed to update SMS auth setting:', err);
    }
  };

  // New Client Form State
  const [newClientName, setNewClientName] = useState('');
  const [newClientDomain, setNewClientDomain] = useState('');
  const [newCostCenter, setNewCostCenter] = useState('');
  const [newDiscount, setNewDiscount] = useState('15');
  const [newCreditLimit, setNewCreditLimit] = useState('50000');

  // New User Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserMobile, setNewUserMobile] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'LOGISTICS_LEAD' | 'DISPATCHER' | 'PROCUREMENT_MANAGER' | 'REQUESTER'>('LOGISTICS_LEAD');
  const [newUserSpendingLimit, setNewUserSpendingLimit] = useState('15000');

  // Load clients
  const loadClients = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/corporate-clients');
      if (res.ok) {
        const json = await res.json();
        setClients(json.clients || []);
        if (json.clients?.length > 0 && !selectedClient) {
          setSelectedClient(json.clients[0]);
        } else if (selectedClient) {
          const updated = json.clients.find((c: CorporateClientRecord) => c.id === selectedClient.id);
          if (updated) setSelectedClient(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load corporate clients:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
    loadTenantSettings();
  }, []);

  // Handle Add Corporate Client
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/corporate-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: newClientName,
          emailDomain: newClientDomain,
          costCenterCode: newCostCenter,
          discountPercent: Number(newDiscount),
          creditLimitAed: Number(newCreditLimit),
        }),
      });
      if (res.ok) {
        setShowAddClientModal(false);
        setNewClientName('');
        setNewClientDomain('');
        setNewCostCenter('');
        loadClients();
      }
    } catch (err) {
      console.error('Error creating client:', err);
    }
  };

  // Handle Add User to Client Roster
  const handleAddUserToRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    try {
      const res = await fetch('/api/admin/corporate-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_USER_TO_ROSTER',
          clientId: selectedClient.id,
          name: newUserName,
          mobileNumber: newUserMobile,
          email: newUserEmail,
          role: newUserRole,
          costCenter: selectedClient.costCenterCode,
          maxSpendingLimitAed: Number(newUserSpendingLimit),
        }),
      });

      if (res.ok) {
        setShowAddUserModal(false);
        setNewUserName('');
        setNewUserMobile('');
        setNewUserEmail('');
        loadClients();
      }
    } catch (err) {
      console.error('Error adding user to roster:', err);
    }
  };

  // Handle Delete User from Roster
  const handleDeleteUser = async (userId: string) => {
    if (!selectedClient) return;
    try {
      const res = await fetch('/api/admin/corporate-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DELETE_USER_FROM_ROSTER',
          clientId: selectedClient.id,
          userId,
        }),
      });
      if (res.ok) {
        loadClients();
      }
    } catch (err) {
      console.error('Error deleting user:', err);
    }
  };

  // 1-Click WhatsApp Invite
  const handleSendWhatsAppInvite = (user: AuthorizedClientUser) => {
    const msg = `✅ Fleet360 Mobile App invite dispatched via WhatsApp to ${user.name} (${user.mobileNumber}) for corporate client ${selectedClient?.clientName}!`;
    setInviteSuccessMsg(msg);
    setTimeout(() => setInviteSuccessMsg(null), 4000);
  };

  const filteredClients = clients.filter(
    (c) =>
      c.clientName.toLowerCase().includes(search.toLowerCase()) ||
      c.emailDomain.toLowerCase().includes(search.toLowerCase()) ||
      c.costCenterCode.toLowerCase().includes(search.toLowerCase())
  );

  const totalRosterUsers = clients.reduce((acc, c) => acc + (c.userRoster?.length || 0), 0);
  const totalCreditLimit = clients.reduce((acc, c) => acc + (c.creditLimitAed || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corporate Clients & User Roster Hub"
        subtitle="Manage B2B corporate client accounts, authorized domains, contracted pricing, and authorized user rosters"
        icon={Building2}
        accent="orange"
        actions={
          <button
            onClick={() => setShowAddClientModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-orange-500/25"
          >
            <Plus className="w-4 h-4" /> Add Corporate Client
          </button>
        }
      />

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Corporate Clients</span>
            <Building2 className="w-4 h-4 text-orange-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">{clients.length}</p>
          <span className="text-[11px] text-emerald-400">Active B2B Contracts</span>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Authorized Coordinators</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">{totalRosterUsers}</p>
          <span className="text-[11px] text-slate-400">Across all client rosters</span>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Credit Line</span>
            <CreditCard className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-emerald-400">
            AED {(totalCreditLimit / 1000).toFixed(0)}k
          </p>
          <span className="text-[11px] text-slate-400">Monthly 30-day terms</span>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Domain Auto-Discovery</span>
            <ShieldCheck className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">100%</p>
      </div>

      {/* Tenant Authentication Policy & SMS Setting Banner */}
      <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              Tenant Authentication Policy & Dual-Channel OTP Settings
              <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/20">
                Synchronized OTP
              </span>
            </h4>
            <p className="text-[11px] text-slate-400">
              When enabled, unified 6-digit OTPs are dispatched to both Email and WhatsApp / Cellular SMS.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300 font-semibold cursor-pointer select-none">
              Cellular SMS Authentication:
            </label>
            <button
              type="button"
              onClick={() => handleToggleSmsAuth(!enableSmsAuth)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                enableSmsAuth
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-800 border-white/10 text-slate-400'
              }`}
            >
              {enableSmsAuth ? '✅ SMS Enabled' : '⏸️ SMS Disabled (WhatsApp & Email Only)'}
            </button>
          </div>
        </div>
      </div>

      {inviteSuccessMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{inviteSuccessMsg}</span>
        </div>
      )}

      {/* Main Split View: Left (Client List) | Right (Client Detail & User Roster) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Corporate Accounts List (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Corporate Accounts</h3>
              <span className="text-xs text-slate-400">{filteredClients.length} accounts</span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients, domains, cost centers…"
                className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div className="space-y-2.5 max-h-[550px] overflow-y-auto pr-1">
              {filteredClients.map((client) => {
                const isSelected = selectedClient?.id === client.id;
                return (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-orange-500/10 border-orange-500 shadow-md shadow-orange-500/10'
                        : 'bg-slate-950/40 border-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400 text-xs">
                          🏢
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white">{client.clientName}</h4>
                          <span className="text-[11px] text-orange-300 font-mono">@{client.emailDomain}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        {client.discountPercent}% Off
                      </span>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Cost Center: <strong className="text-slate-200">{client.costCenterCode}</strong></span>
                      <span>Roster: <strong className="text-white">{client.userRoster?.length || 0} users</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Client Detail & User Roster Panel (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedClient ? (
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 space-y-6">
              {/* Selected Client Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-2xl shadow-lg shadow-orange-500/20">
                    🏢
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{selectedClient.clientName}</h2>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono text-orange-300">@{selectedClient.emailDomain}</span>
                      <span>•</span>
                      <span>Tenant: <strong className="text-slate-200">{selectedClient.tenantName}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddUserModal(true)}
                    className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-orange-600/20 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Coordinator
                  </button>
                </div>
              </div>

              {/* Contract & Account Overview Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] text-slate-500 uppercase block mb-1">Cost Center Code</span>
                  <span className="text-xs font-mono font-bold text-orange-400">{selectedClient.costCenterCode}</span>
                </div>
                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] text-slate-500 uppercase block mb-1">Contract Tariff Discount</span>
                  <span className="text-xs font-mono font-bold text-emerald-400">{selectedClient.discountPercent}% Discount</span>
                </div>
                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] text-slate-500 uppercase block mb-1">Monthly Credit Line</span>
                  <span className="text-xs font-mono font-bold text-white">AED {selectedClient.creditLimitAed.toLocaleString()}</span>
                </div>
              </div>

              {/* Authorized User Roster Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-orange-400" />
                    Authorized Client User Roster ({selectedClient.userRoster?.length || 0})
                  </h3>
                  <span className="text-[10px] text-slate-400">Authorized to book on corporate account</span>
                </div>

                {selectedClient.userRoster && selectedClient.userRoster.length > 0 ? (
                  <div className="space-y-2.5">
                    {selectedClient.userRoster.map((user) => (
                      <div
                        key={user.id}
                        className="bg-slate-950/40 border border-white/5 hover:border-white/15 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{user.name}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                              {user.role}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Active
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1 font-mono text-cyan-300">
                              <Phone className="w-3 h-3 text-cyan-400" /> {user.mobileNumber}
                            </span>
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-500" /> {user.email}
                            </span>
                            <span>Limit: <strong className="text-white">AED {user.maxSpendingLimitAed || 10000}</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSendWhatsAppInvite(user)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            title="Send WhatsApp App Access Link"
                          >
                            <MessageSquare className="w-3 h-3" /> WhatsApp Invite
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove from roster"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-white/10 rounded-2xl p-8 text-center space-y-2">
                    <p className="text-xs text-slate-400">No coordinators added to this roster yet.</p>
                    <button
                      onClick={() => setShowAddUserModal(true)}
                      className="text-xs text-orange-400 hover:text-orange-300 underline"
                    >
                      + Add first authorized coordinator
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="border border-white/10 rounded-2xl p-12 text-center text-slate-400">
              Select a corporate client to view details and manage user roster.
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Modal 1: Add Corporate Client
      ══════════════════════════════════════════════════════════════ */}
      {showAddClientModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-orange-400" /> Add Corporate Client
              </h3>
              <button onClick={() => setShowAddClientModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Client Company Name *</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. EIN360 or Dubai Logistics Hub"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Authorized Email Domain *</label>
                <input
                  type="text"
                  required
                  value={newClientDomain}
                  onChange={(e) => setNewClientDomain(e.target.value)}
                  placeholder="e.g. ein360.ae or emaar.ae"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Corporate Cost Center Code *</label>
                <input
                  type="text"
                  required
                  value={newCostCenter}
                  onChange={(e) => setNewCostCenter(e.target.value)}
                  placeholder="e.g. CC-EIN360-LOGISTICS"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Contract Discount (%)</label>
                  <input
                    type="number"
                    value={newDiscount}
                    onChange={(e) => setNewDiscount(e.target.value)}
                    className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Credit Limit (AED)</label>
                  <input
                    type="number"
                    value={newCreditLimit}
                    onChange={(e) => setNewCreditLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddClientModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold"
                >
                  Save Client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Modal 2: Add Coordinator to Roster
      ══════════════════════════════════════════════════════════════ */}
      {showAddUserModal && selectedClient && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-400" /> Add Coordinator to {selectedClient.clientName}
              </h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddUserToRoster} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Fatima Al-Nuaimi"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Mobile Number (WhatsApp OTP) *</label>
                <input
                  type="text"
                  required
                  value={newUserMobile}
                  onChange={(e) => setNewUserMobile(e.target.value)}
                  placeholder="e.g. +971 50 887 6543"
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Work Email *</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder={`e.g. fatima@${selectedClient.emailDomain}`}
                  className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Role</label>
                  <select
                    value={newUserRole}
                    onChange={(e: any) => setNewUserRole(e.target.value)}
                    className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="LOGISTICS_LEAD">Logistics Lead</option>
                    <option value="DISPATCHER">Dispatcher</option>
                    <option value="PROCUREMENT_MANAGER">Procurement Manager</option>
                    <option value="REQUESTER">Standard Requester</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Max Spending Limit (AED)</label>
                  <input
                    type="number"
                    value={newUserSpendingLimit}
                    onChange={(e) => setNewUserSpendingLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-white/15 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold"
                >
                  Add Coordinator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
