'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Network,
  Plus,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Server,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
  Activity,
  Layers,
  Code,
  Lock,
  ExternalLink,
} from 'lucide-react';

interface Connection {
  id: string;
  systemName: string;
  systemType: string;
  baseUrl: string;
  authType: string;
  isActive: boolean;
  rateLimitPerMin: number;
  healthStatus: 'HEALTHY' | 'WARNING' | 'ERROR' | 'UNTESTED';
  healthMessage?: string;
  lastSyncAt?: string;
  createdAt: string;
}

export default function EnterpriseBridgePage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [systemName, setSystemName] = useState('');
  const [systemType, setSystemType] = useState('SAP_S4HANA');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState('API_KEY');
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/enterprise/connections');
      const data = await res.json();
      if (res.ok && data.connections) {
        setConnections(data.connections);
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleCreateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const authCredentials: Record<string, any> = {};
    if (authType === 'API_KEY') authCredentials.apiKey = apiKey;
    if (authType === 'BEARER_TOKEN') authCredentials.token = token;
    if (authType === 'BASIC_AUTH') {
      authCredentials.username = username;
      authCredentials.password = password;
    }

    try {
      const res = await fetch('/api/integrations/enterprise/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemName,
          systemType,
          baseUrl,
          authType,
          authCredentials,
          testNow: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save connection');

      setShowAddModal(false);
      // Reset form
      setSystemName('');
      setBaseUrl('');
      setApiKey('');
      setToken('');
      setUsername('');
      setPassword('');
      await loadConnections();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (conn: Connection) => {
    setTestingId(conn.id);
    try {
      const res = await fetch('/api/integrations/enterprise/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'INVOICE',
          entityId: `TEST-${Date.now()}`,
          payload: {
            invoiceNumber: `TEST-PING-${Date.now()}`,
            clientCode: 'TEST_CLIENT',
            totalAmountAed: 100,
          },
        }),
      });
      await loadConnections();
    } catch {
      // Refresh state
    } finally {
      setTestingId(null);
    }
  };

  const healthyCount = connections.filter((c) => c.healthStatus === 'HEALTHY').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 p-2 text-white shadow-lg shadow-indigo-500/20">
              <Network className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-main)]">Enterprise Bridge Hub</h1>
              <p className="text-xs text-[var(--text-muted)]">
                Autonomous multi-system ERP connector: SAP, Oracle NetSuite, MS Dynamics, Odoo, and Custom OpenAPI backends.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 shadow-sm transition-all"
          >
            <Plus className="h-4 w-4" />
            Connect New ERP
          </button>
          <button
            onClick={loadConnections}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Connected Systems</span>
            <Server className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-main)]">{connections.length}</div>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Multi-tenant adapters configured</p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5">
          <div className="flex items-center justify-between text-emerald-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Connection Health</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-main)]">{healthyCount} / {connections.length}</div>
          <p className="mt-1 text-xs text-emerald-300">Active live endpoints verified</p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Autonomy Policy</span>
            <ShieldCheck className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-main)]">L3 Gate</div>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Mutations &gt; AED 500 held for review</p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Protocols Supported</span>
            <Activity className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-extrabold text-[var(--text-main)]">7 Modes</div>
          <p className="mt-1 text-xs text-[var(--text-faint)]">OData, REST, JSON-RPC, OpenAPI</p>
        </div>
      </div>

      {/* Connected Systems Grid */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-main)]">Registered Enterprise Connections</h2>

        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/30 p-12 text-center text-[var(--text-muted)]">
            <Server className="mx-auto h-10 w-10 text-indigo-400/50 mb-3" />
            <h3 className="text-sm font-semibold text-[var(--text-main)]">No Enterprise Systems Connected</h3>
            <p className="text-xs mt-1 max-w-md mx-auto">
              Connect your SAP S/4HANA, Oracle NetSuite, MS Dynamics, Odoo, or Custom REST APIs to enable autonomous agentic syncing.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              Connect First ERP
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-3 hover:border-indigo-500/40 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-indigo-500/20 text-indigo-300 px-2 py-0.5 text-[10px] font-bold">
                      {conn.systemType}
                    </span>
                    <h3 className="text-sm font-bold text-[var(--text-main)] mt-1.5">{conn.systemName}</h3>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      conn.healthStatus === 'HEALTHY'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {conn.healthStatus}
                  </span>
                </div>

                <div className="text-xs text-[var(--text-muted)] truncate font-mono bg-black/20 p-2 rounded border border-white/5">
                  {conn.baseUrl}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--text-faint)] pt-2 border-t border-[var(--border-subtle)]">
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Auth: {conn.authType}
                  </span>
                  <button
                    onClick={() => testConnection(conn)}
                    disabled={testingId === conn.id}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                  >
                    {testingId === conn.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                    Test Ping
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Add Connection */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)]">Connect Enterprise ERP</h3>
                <p className="text-xs text-[var(--text-muted)]">Configure protocol credentials and endpoints.</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-xs text-[var(--text-muted)] hover:text-white"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateConnection} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-main)] mb-1">System Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Dubai Holding SAP S/4HANA Finance"
                  value={systemName}
                  onChange={(e) => setSystemName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-main)] mb-1">ERP Protocol / System</label>
                  <select
                    value={systemType}
                    onChange={(e) => setSystemType(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="SAP_S4HANA">SAP S/4HANA (OData)</option>
                    <option value="ORACLE_NETSUITE">Oracle NetSuite (SuiteTalk REST)</option>
                    <option value="MS_DYNAMICS_365">MS Dynamics 365 (Dataverse)</option>
                    <option value="ODOO">Odoo (JSON-RPC)</option>
                    <option value="ZOHO_BOOKS">Zoho Books (REST)</option>
                    <option value="CUSTOM_REST">Custom Enterprise REST</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-main)] mb-1">Authentication Method</label>
                  <select
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="API_KEY">API Key Header</option>
                    <option value="BEARER_TOKEN">Bearer Token (OAuth)</option>
                    <option value="BASIC_AUTH">Basic Auth (Username / Password)</option>
                    <option value="NONE">None (Open Gateway)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[var(--text-main)] mb-1">Base API URL</label>
                <input
                  type="url"
                  placeholder="https://sap.company.ae/sap/opu/odata/sap/"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {authType === 'API_KEY' && (
                <div>
                  <label className="block font-medium text-[var(--text-main)] mb-1">API Key / Secret</label>
                  <input
                    type="password"
                    placeholder="Enter API Secret"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              {authType === 'BEARER_TOKEN' && (
                <div>
                  <label className="block font-medium text-[var(--text-main)] mb-1">Bearer Access Token</label>
                  <input
                    type="password"
                    placeholder="eyJhbGciOi..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              {authType === 'BASIC_AUTH' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-[var(--text-main)] mb-1">Username</label>
                    <input
                      type="text"
                      placeholder="admin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[var(--text-main)] mb-1">Password</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-main)] focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-all disabled:opacity-50"
                >
                  {saving ? 'Testing & Saving...' : 'Save & Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
