'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface BLEGateway {
  id: string;
  gateway_code: string;
  name: string;
  location_type?: string;
  location_name?: string;
  location_zone?: string;
  vehicle_id?: string;
  tags_visible?: number;
  last_heartbeat?: string;
  status?: string;
  lat?: number;
  lng?: number;
  ip_address?: string;
  firmware_version?: string;
  offline_threshold_min?: number;
  alert_on_offline?: boolean;
  api_key_prefix?: string;
  api_key_created_at?: string;
}

interface KeygenResult {
  raw_key: string;
  prefix: string;
  created_at: string;
  gateway_code: string;
}

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  OFFLINE: 'bg-red-500/20 text-red-400 border-red-500/30',
  DEGRADED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  MAINTENANCE: 'bg-slate-700 text-slate-400 border-slate-600',
};

const LOCATION_TYPES = ['WAREHOUSE', 'AMBULANCE', 'VEHICLE', 'FACILITY', 'FIELD', 'OTHER'];

const EMPTY_FORM = {
  name: '', location_type: 'WAREHOUSE', location_name: '', location_zone: '',
  vehicle_id: '', lat: '', lng: '', ip_address: '', firmware_version: '',
  offline_threshold_min: 10, alert_on_offline: true,
};

function RssiBar({ rssi }: { rssi: number }) {
  const pct = Math.max(0, Math.min(100, ((rssi + 100) / 60) * 100));
  const color = pct > 66 ? 'bg-emerald-500' : pct > 33 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{rssi} dBm</span>
    </div>
  );
}

function CodeBlock({ code, language = '' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <div className="bg-slate-950 border border-white/8 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre">
        {code}
      </div>
      <button
        onClick={copy}
        className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      {language && (
        <span className="absolute top-2 left-3 text-[10px] text-slate-600 font-sans">{language}</span>
      )}
    </div>
  );
}

export default function BLEGatewaysPage() {
  const [gateways, setGateways] = useState<BLEGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editGateway, setEditGateway] = useState<BLEGateway | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Hardware integration drawer state
  const [drawerGateway, setDrawerGateway] = useState<BLEGateway | null>(null);
  const [drawerTab, setDrawerTab] = useState<'apikey' | 'guide'>('apikey');
  const [keygenResult, setKeygenResult] = useState<KeygenResult | null>(null);
  const [keygenLoading, setKeygenLoading] = useState(false);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/ble-gateways?tenantId=default');
      const d = await r.json();
      setGateways(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load gateways'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditGateway(null); setForm({ ...EMPTY_FORM }); setShowModal(true); };
  const openEdit = (g: BLEGateway) => {
    setEditGateway(g);
    setForm({
      name: g.name, location_type: g.location_type ?? 'WAREHOUSE', location_name: g.location_name ?? '',
      location_zone: g.location_zone ?? '', vehicle_id: g.vehicle_id ?? '',
      lat: g.lat?.toString() ?? '', lng: g.lng?.toString() ?? '',
      ip_address: g.ip_address ?? '', firmware_version: g.firmware_version ?? '',
      offline_threshold_min: g.offline_threshold_min ?? 10, alert_on_offline: g.alert_on_offline ?? true,
    });
    setShowModal(true);
  };

  const openDrawer = (g: BLEGateway) => {
    setDrawerGateway(g);
    setDrawerTab('apikey');
    setKeygenResult(null);
    setShowRotateConfirm(false);
    setTestResult(null);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = { ...form, lat: form.lat ? parseFloat(form.lat) : undefined, lng: form.lng ? parseFloat(form.lng) : undefined, tenantId: 'default' };
      let res;
      if (editGateway) {
        res = await fetch(`/api/assets/ble-gateways/${editGateway.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        res = await fetch('/api/assets/ble-gateways?tenantId=default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      if (!res.ok) throw new Error();
      showToast(editGateway ? 'Gateway updated!' : 'Gateway created!');
      setShowModal(false); load();
    } catch { showToast('Error saving gateway', 'error'); }
    setSubmitting(false);
  };

  const handleKeygen = async (rotate = false) => {
    if (!drawerGateway) return;
    setKeygenLoading(true);
    setShowRotateConfirm(false);
    try {
      const res = await fetch(`/api/assets/ble-gateways/${drawerGateway.id}/keygen`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const data: KeygenResult = await res.json();
      setKeygenResult(data);
      showToast(rotate ? 'API key rotated successfully' : 'API key generated!');
      load();
    } catch { showToast('Failed to generate key', 'error'); }
    setKeygenLoading(false);
  };

  const copyKey = () => {
    if (!keygenResult) return;
    navigator.clipboard.writeText(keygenResult.raw_key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const testConnection = async () => {
    if (!drawerGateway) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const payload = {
        gateway_code: drawerGateway.gateway_code,
        timestamp: new Date().toISOString(),
        detections: [{
          tag_mac: 'TEST:00:00:00:00:01',
          rssi: -65,
          tx_power: -59,
          battery_pct: 100,
          detected_at: new Date().toISOString(),
        }],
      };
      const res = await fetch('/api/assets/ble/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gateway-Key': keygenResult?.raw_key ?? 'test' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    }
    setTestLoading(false);
  };

  function minutesAgo(dt?: string) {
    if (!dt) return null;
    return Math.round((Date.now() - new Date(dt).getTime()) / 60000);
  }

  const buildIngestDocs = (gw: BLEGateway) => {
    const httpExample = `POST https://your-domain.com/api/assets/ble/ingest
Headers:
  X-Gateway-Key: <your-api-key>
  Content-Type: application/json

Body:
{
  "gateway_code": "${gw.gateway_code}",
  "timestamp": "<ISO8601>",
  "detections": [
    {
      "tag_mac": "AA:BB:CC:DD:EE:FF",
      "rssi": -72,
      "tx_power": -59,
      "battery_pct": 85,
      "detected_at": "<ISO8601>"
    }
  ]
}`;

    const curlExample = `curl -X POST https://your-domain.com/api/assets/ble/ingest \\
  -H "X-Gateway-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "gateway_code": "${gw.gateway_code}",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "detections": [{
      "tag_mac": "AA:BB:CC:DD:EE:FF",
      "rssi": -72,
      "tx_power": -59,
      "battery_pct": 85,
      "detected_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }]
  }'`;

    const pythonExample = `import requests
from datetime import datetime, timezone

API_KEY = "YOUR_API_KEY"
GATEWAY_CODE = "${gw.gateway_code}"

payload = {
    "gateway_code": GATEWAY_CODE,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "detections": [
        {
            "tag_mac": "AA:BB:CC:DD:EE:FF",
            "rssi": -72,
            "tx_power": -59,
            "battery_pct": 85,
            "detected_at": datetime.now(timezone.utc).isoformat()
        }
    ]
}

response = requests.post(
    "https://your-domain.com/api/assets/ble/ingest",
    headers={
        "X-Gateway-Key": API_KEY,
        "Content-Type": "application/json"
    },
    json=payload
)
print(response.json())`;

    const arduinoExample = `// Arduino / ESP32 BLE Gateway — Pseudocode
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <BLEScan.h>

const char* API_URL = "https://your-domain.com/api/assets/ble/ingest";
const char* API_KEY = "YOUR_API_KEY";
const char* GATEWAY_CODE = "${gw.gateway_code}";

void sendDetection(String tagMac, int rssi, int battery) {
  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Gateway-Key", API_KEY);

  StaticJsonDocument<512> doc;
  doc["gateway_code"] = GATEWAY_CODE;
  doc["timestamp"] = getISO8601Time();

  JsonArray detections = doc.createNestedArray("detections");
  JsonObject det = detections.createNestedObject();
  det["tag_mac"] = tagMac;
  det["rssi"] = rssi;
  det["tx_power"] = -59;
  det["battery_pct"] = battery;
  det["detected_at"] = getISO8601Time();

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  http.end();
}

// In loop(): scan BLE, collect advertisements, call sendDetection()`;

    return { httpExample, curlExample, pythonExample, arduinoExample };
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  const docs = drawerGateway ? buildIngestDocs(drawerGateway) : null;

  return (
    <div className="p-8 space-y-5">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${toastType === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">BLE Gateways</h1>
          <p className="text-slate-400 text-sm">Location gateway network status & hardware integration</p>
        </div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">+ Add Gateway</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {gateways.filter(g => g.status === 'OFFLINE').length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <span className="text-red-400 text-xl">🚨</span>
          <span className="text-red-300 font-medium">{gateways.filter(g => g.status === 'OFFLINE').length} gateway(s) currently OFFLINE</span>
        </div>
      )}

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Gateway Code', 'Name', 'Location Type', 'Location Name', 'Zone', 'Tags Visible', 'Last Heartbeat', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {gateways.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">📶</div><p>No BLE gateways configured yet.</p>
                </td></tr>
              ) : gateways.map(g => {
                const ago = minutesAgo(g.last_heartbeat);
                const threshold = g.offline_threshold_min ?? 10;
                const overdue = ago !== null && ago > threshold;
                const isExpanded = drawerGateway?.id === g.id;
                return (
                  <React.Fragment key={g.id}>
                    <tr
                      className={`hover:bg-white/3 transition-colors cursor-pointer ${isExpanded ? 'bg-yellow-300/5 border-b-0' : ''}`}
                      onClick={() => isExpanded ? setDrawerGateway(null) : openDrawer(g)}
                    >
                      <td className="px-4 py-3 text-yellow-300 font-mono text-xs">{g.gateway_code}</td>
                      <td className="px-4 py-3 text-white font-medium">{g.name}</td>
                      <td className="px-4 py-3 text-slate-400">{g.location_type ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{g.location_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{g.location_zone ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-300 font-medium">{g.tags_visible ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${overdue ? 'text-red-400' : 'text-slate-400'}`}>
                          {ago !== null ? `${ago}m ago` : '—'}
                          {overdue && <span className="ml-1">⚠️</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {g.status === 'ONLINE' && <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />}
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[g.status ?? 'OFFLINE'] ?? STATUS_COLORS.OFFLINE}`}>
                            {g.status ?? 'OFFLINE'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(g)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Edit</button>
                          <button
                            onClick={() => isExpanded ? setDrawerGateway(null) : openDrawer(g)}
                            className="text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 px-2 py-1 rounded border border-yellow-500/30"
                          >
                            {isExpanded ? '▲ HW' : '▼ HW'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="px-0 pt-0 pb-0">
                          <div className="bg-slate-950/70 border-t border-yellow-500/20 border-b border-white/8 p-6">
                            <div className="flex items-center gap-2 mb-4">
                              <span className="text-yellow-400 font-semibold text-sm">⚡ Hardware Integration Panel</span>
                              <span className="text-slate-500 text-xs">— {g.name} ({g.gateway_code})</span>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-1 mb-5 bg-slate-900 p-1 rounded-lg w-fit border border-white/8">
                              {[
                                { key: 'apikey', label: '🔑 API Key Management' },
                                { key: 'guide', label: '📖 Integration Guide' },
                              ].map(t => (
                                <button
                                  key={t.key}
                                  onClick={() => setDrawerTab(t.key as 'apikey' | 'guide')}
                                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${drawerTab === t.key ? 'bg-yellow-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>

                            {drawerTab === 'apikey' && (
                              <div className="space-y-4 max-w-2xl">
                                {/* Current key status */}
                                <div className="bg-slate-900 border border-white/8 rounded-xl p-4">
                                  <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider">Current API Key Status</p>
                                  {g.api_key_prefix ? (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-3">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                        <code className="font-mono text-sm text-emerald-400">{g.api_key_prefix}...</code>
                                        <span className="text-xs text-slate-500">Key active</span>
                                      </div>
                                      {g.api_key_created_at && (
                                        <p className="text-xs text-slate-500 ml-5">
                                          Generated {new Date(g.api_key_created_at).toLocaleDateString()} at {new Date(g.api_key_created_at).toLocaleTimeString()}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                                      <span className="w-2 h-2 rounded-full bg-slate-600" />
                                      No key generated — click below to generate one
                                    </div>
                                  )}
                                </div>

                                {/* Generated key display */}
                                {keygenResult && (
                                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                                      <span>⚠️</span>
                                      <span>Copy this key now — it will never be shown again</span>
                                    </div>
                                    <div className="relative">
                                      <div className="bg-slate-950 border border-amber-500/30 rounded-lg px-4 py-3 font-mono text-sm text-yellow-300 break-all">
                                        {keygenResult.raw_key}
                                      </div>
                                      <button
                                        onClick={copyKey}
                                        className={`absolute top-2 right-2 text-xs px-3 py-1 rounded font-medium transition-all ${keyCopied ? 'bg-emerald-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                                      >
                                        {keyCopied ? '✓ Copied!' : 'Copy'}
                                      </button>
                                    </div>
                                    <div className="text-xs text-slate-400 space-y-1">
                                      <p><span className="text-slate-500">Prefix:</span> <code className="font-mono">{keygenResult.prefix}</code></p>
                                      <p><span className="text-slate-500">Created:</span> {new Date(keygenResult.created_at).toLocaleString()}</p>
                                      <p><span className="text-slate-500">Gateway Code:</span> <code className="font-mono">{keygenResult.gateway_code}</code></p>
                                    </div>
                                  </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex items-center gap-3">
                                  {!g.api_key_prefix && !keygenResult && (
                                    <button
                                      onClick={() => handleKeygen(false)}
                                      disabled={keygenLoading}
                                      className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                                    >
                                      {keygenLoading ? 'Generating...' : '🔑 Generate API Key'}
                                    </button>
                                  )}
                                  {(g.api_key_prefix || keygenResult) && (
                                    <>
                                      {showRotateConfirm ? (
                                        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                                          <span className="text-red-400 text-xs">This will invalidate the existing key. Continue?</span>
                                          <button onClick={() => handleKeygen(true)} disabled={keygenLoading} className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded">
                                            {keygenLoading ? 'Rotating...' : 'Yes, Rotate'}
                                          </button>
                                          <button onClick={() => setShowRotateConfirm(false)} className="text-xs text-slate-400 hover:text-white px-2 py-1">Cancel</button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setShowRotateConfirm(true)}
                                          className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium px-4 py-2 rounded-lg text-sm"
                                        >
                                          🔄 Rotate Key
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>

                                {/* Test Connection */}
                                <div className="pt-2 border-t border-white/8">
                                  <p className="text-xs text-slate-400 mb-2 font-medium">Test Gateway Connection</p>
                                  <button
                                    onClick={testConnection}
                                    disabled={testLoading}
                                    className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-4 py-2 rounded-lg disabled:opacity-50"
                                  >
                                    {testLoading ? '⏳ Sending test...' : '🔌 Test Connection'}
                                  </button>
                                  <p className="text-xs text-slate-500 mt-1">Sends a dummy tag detection (TEST:00:00:00:00:01) to verify the ingest endpoint.</p>
                                  {testResult && (
                                    <div className="mt-3">
                                      <p className="text-xs text-slate-400 mb-1">API Response:</p>
                                      <div className="bg-slate-950 border border-white/8 rounded-lg p-3 font-mono text-xs text-slate-300 max-h-48 overflow-auto whitespace-pre">
                                        {testResult}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {drawerTab === 'guide' && docs && (
                              <div className="space-y-6 max-w-3xl">
                                <div>
                                  <p className="text-sm font-semibold text-white mb-2">HTTP Request Format</p>
                                  <CodeBlock code={docs.httpExample} language="HTTP" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-white mb-2">cURL Example</p>
                                  <CodeBlock code={docs.curlExample} language="bash" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-white mb-2">Python (requests)</p>
                                  <CodeBlock code={docs.pythonExample} language="python" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-white mb-2">Arduino / ESP32</p>
                                  <CodeBlock code={docs.arduinoExample} language="C++" />
                                </div>
                                <div className="bg-slate-900 border border-white/8 rounded-xl p-4 text-xs text-slate-400 space-y-1">
                                  <p className="text-white text-sm font-medium mb-2">Field Reference</p>
                                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                    {[
                                      ['gateway_code', 'Your gateway identifier'],
                                      ['timestamp', 'ISO 8601 batch timestamp'],
                                      ['tag_mac', 'BLE tag MAC address (AA:BB:...)'],
                                      ['rssi', 'Signal strength in dBm (negative int)'],
                                      ['tx_power', 'Advertised TX power in dBm'],
                                      ['battery_pct', 'Tag battery percentage (0-100)'],
                                      ['detected_at', 'ISO 8601 per-detection timestamp'],
                                    ].map(([field, desc]) => (
                                      <React.Fragment key={field}>
                                        <code className="text-yellow-300 font-mono">{field}</code>
                                        <span>{desc}</span>
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <h2 className="text-white font-semibold">{editGateway ? 'Edit Gateway' : 'Add BLE Gateway'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Gateway Name*</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Location Type</label>
                <select value={form.location_type} onChange={e => setForm(p => ({ ...p, location_type: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Location Name</label>
                <input value={form.location_name} onChange={e => setForm(p => ({ ...p, location_name: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Zone</label>
                <input value={form.location_zone} onChange={e => setForm(p => ({ ...p, location_zone: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              {(form.location_type === 'AMBULANCE' || form.location_type === 'VEHICLE') && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vehicle ID</label>
                  <input value={form.vehicle_id} onChange={e => setForm(p => ({ ...p, vehicle_id: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">IP Address</label>
                <input value={form.ip_address} onChange={e => setForm(p => ({ ...p, ip_address: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Firmware Version</label>
                <input value={form.firmware_version} onChange={e => setForm(p => ({ ...p, firmware_version: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Latitude</label>
                <input value={form.lat} onChange={e => setForm(p => ({ ...p, lat: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Longitude</label>
                <input value={form.lng} onChange={e => setForm(p => ({ ...p, lng: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Offline Threshold (min)</label>
                <input type="number" value={form.offline_threshold_min} onChange={e => setForm(p => ({ ...p, offline_threshold_min: parseInt(e.target.value) || 10 }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input type="checkbox" checked={form.alert_on_offline} onChange={e => setForm(p => ({ ...p, alert_on_offline: e.target.checked }))} id="alertOnOffline" className="w-4 h-4 rounded" />
                <label htmlFor="alertOnOffline" className="text-sm text-slate-300">Alert when offline</label>
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submit} disabled={submitting || !form.name} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : editGateway ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
