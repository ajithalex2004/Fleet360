'use client';

import React, { useState } from 'react';
import {
  MessageSquare,
  Sparkles,
  Zap,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Car,
  Wrench,
  Shield,
  Layers,
  ArrowRight,
  RefreshCw,
  Phone,
} from 'lucide-react';

interface IngestResult {
  ok: boolean;
  intent: {
    ticketType: string;
    priority: string;
    title: string;
    description: string;
    extractedPlateNumber?: string | null;
    extractedLocation?: string | null;
    confidence: number;
    tierUsed: string;
    category: string;
    suggestedAutoReply: string;
  };
  ticket: {
    id: string;
    readableId: string;
    ticketType: string;
    priority: string;
    title: string;
    description: string;
    extractedPlateNumber?: string | null;
    category: string;
    tierUsed: string;
    confidence: number;
  };
  autoReply: string;
}

const PRESET_SCENARIOS = [
  {
    label: '🚨 Highway Breakdown & Towing',
    text: 'My bus broke down on Sheikh Zayed Road near Exit 36, plate Dubai B 45210, coolant leaking everywhere, need immediate towing truck!',
    sender: '+971 50 123 4567',
    name: 'Ahmed Driver',
  },
  {
    label: '🇦🇪 Arabic Roadside Puncture',
    text: 'عندي بنشر في شارع الشيخ زايد للباص رقم دبي 54321',
    sender: '+971 55 987 6543',
    name: 'Tariq Al Mansoor',
  },
  {
    label: '🇵🇰 Urdu Engine Stoppage',
    text: 'Gari band ho gayi hai Al Barsha mein, please send tow truck plate Abu Dhabi 5 99882',
    sender: '+971 52 444 3322',
    name: 'Suresh Kumar',
  },
  {
    label: '❄️ AC Failure in Summer',
    text: 'The AC is not cooling and blowing hot air in Sharjah 4412',
    sender: '+971 54 888 1122',
    name: 'John Operations',
  },
  {
    label: '💥 Rear Collision Accident',
    text: 'Car hit our bus rear bumper on E311 near Dubai South, police report required, plate Dubai C 99812',
    sender: '+971 50 777 6655',
    name: 'Fleet Coordinator',
  },
];

export default function WhatsAppSimulatorPage() {
  const [message, setMessage] = useState(PRESET_SCENARIOS[0].text);
  const [sender, setSender] = useState(PRESET_SCENARIOS[0].sender);
  const [customerName, setCustomerName] = useState(PRESET_SCENARIOS[0].name);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  const handleSimulate = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();

    try {
      const res = await fetch('/api/service-tickets/whatsapp-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `whatsapp:${sender.replace(/\s+/g, '')}`,
          body: message,
          customerName,
        }),
      });

      const elapsed = Math.round(performance.now() - t0);
      setExecutionTimeMs(elapsed);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              💬 Pillar 1 Ingestion
            </span>
            <span className="text-xs text-slate-400">Hybrid 2-Tier NLP (Google Gemini 2.0 Flash)</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">WhatsApp & Omnichannel Ticket Simulator</h1>
          <p className="text-xs text-slate-400">
            Test multilingual driver WhatsApp messages, live UAE license plate extraction, and instant ticket auto-creation.
          </p>
        </div>
      </div>

      {/* Preset Scenarios */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Quick Preset Driver Scenarios
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESET_SCENARIOS.map((sc, idx) => (
            <button
              key={idx}
              onClick={() => {
                setMessage(sc.text);
                setSender(sc.sender);
                setCustomerName(sc.name);
                setResult(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-all"
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two Columns: Chat Input Phone vs Output Ticket */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Col: WhatsApp Message Composer */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <MessageSquare className="w-5 h-5" />
              <h2 className="font-semibold text-sm text-white">Inbound WhatsApp Message</h2>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Live Webhook Feed
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Driver / Customer Phone</label>
              <input
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Driver Name / Profile</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <label className="block text-slate-400">Message Content (Arabic, Urdu, English, Voice Transcript)</label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter message text with vehicle plate number, issue description, and location..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            onClick={handleSimulate}
            disabled={loading || !message.trim()}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Running Hybrid NLP Triage...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-amber-300" /> Ingest & Auto-Create Service Ticket
              </>
            )}
          </button>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Right Col: AI Extracted Parameters & Generated Service Ticket */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-violet-400">
              <Sparkles className="w-5 h-5" />
              <h2 className="font-semibold text-sm text-white">NLP Extraction & Auto-Provisioned Ticket</h2>
            </div>
            {executionTimeMs !== null && (
              <span className="text-[11px] text-slate-400">
                ⚡ Processed in <span className="text-emerald-400 font-semibold">{executionTimeMs} ms</span>
              </span>
            )}
          </div>

          {!result ? (
            <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 text-xs space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-700" />
              <p>Type or pick a preset scenario and click "Ingest" to test live NLP parsing.</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* NLP Triage Stats Pill */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">NLP Engine Tier</div>
                  <div className="font-bold text-amber-400 mt-0.5">{result.intent.tierUsed}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Confidence Score</div>
                  <div className="font-bold text-emerald-400 mt-0.5">
                    {(result.intent.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Detected Plate</div>
                  <div className="font-bold text-white mt-0.5">
                    {result.intent.extractedPlateNumber || 'None detected'}
                  </div>
                </div>
              </div>

              {/* Service Ticket Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-700/80 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-emerald-400 font-bold">
                      {result.ticket.readableId}
                    </div>
                    <div className="text-sm font-semibold text-white mt-0.5">{result.ticket.title}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      result.ticket.priority === 'High'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : result.ticket.priority === 'Medium'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    {result.ticket.priority} Priority
                  </span>
                </div>

                <p className="text-slate-300 leading-relaxed text-[11px]">{result.ticket.description}</p>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Wrench className="w-3.5 h-3.5 text-slate-500" />
                    Type: <strong className="text-white">{result.ticket.ticketType}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Status: <strong className="text-amber-400">Pending</strong>
                  </span>
                </div>
              </div>

              {/* WhatsApp Auto-Reply Preview Bubble */}
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">
                  WhatsApp Auto-Reply Sent to Driver
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs leading-relaxed whitespace-pre-line font-sans">
                  {result.autoReply}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
