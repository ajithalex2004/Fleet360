'use client';
import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import FleetStatusCard   from '@/components/ops-assistant/FleetStatusCard';
import VehiclesCard      from '@/components/ops-assistant/VehiclesCard';
import MaintenanceCard   from '@/components/ops-assistant/MaintenanceCard';
import AlertsCard        from '@/components/ops-assistant/AlertsCard';
import BookingsCard      from '@/components/ops-assistant/BookingsCard';
import KPIDashboard      from '@/components/ops-assistant/KPIDashboard';

// ── TheSys / Crayon component renderer ───────────────────────────────────────
// The TheSys model returns <content thesys="true"> JSON component trees.
// This renderer handles the common components so we can display them natively.

interface CrayonNode {
  component: string;
  props: Record<string, unknown>;
}

// Context so deeply-nested Buttons can fire sendMessage without prop-drilling
const ChatCtx = React.createContext<(msg: string) => void>(() => {});

const ICON_MAP: Record<string, string> = {
  gauge: '📊', car: '🚗', 'calendar-days': '📅', wrench: '🔧',
  'alert-triangle': '⚠️', truck: '🚛', users: '👥', 'map-pin': '📍',
  'bar-chart': '📈', clipboard: '📋', bell: '🔔', shield: '🛡️',
};

// Map button name / label to a chat prompt
const BUTTON_PROMPTS: Record<string, string> = {
  cta_open_kpis:         'Show me the full KPI dashboard',
  cta_view_vehicles:     'Show me all available vehicles',
  cta_view_bookings:     'Show me current and active bookings',
  cta_view_maintenance:  'Show critical and high priority maintenance requests',
  cta_view_alerts:       'Show all critical alerts and warnings',
  cta_staff_buses:       'Show staff transportation vehicles',
  // fallbacks by label keyword
};

function CrayonRender({ node }: { node: CrayonNode | string | unknown }): React.ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as CrayonNode;
  const p = n.props ?? {};

  switch (n.component) {
    case 'Card':
      return (
        <div className="bg-slate-800/70 border border-white/10 rounded-2xl overflow-hidden">
          {Array.isArray(p.children) && (p.children as CrayonNode[]).map((c, i) => <CrayonRender key={i} node={c} />)}
        </div>
      );
    case 'Header':
      return (
        <div className="px-5 py-4 border-b border-white/10">
          {p.title != null && <h3 className="text-base font-bold text-white">{String(p.title)}</h3>}
          {p.subtitle != null && <p className="text-sm text-slate-400 mt-0.5">{String(p.subtitle)}</p>}
        </div>
      );
    case 'TextContent':
      return (
        <div className="px-5 py-4 text-sm text-slate-300 leading-relaxed">
          {String(p.textMarkdown ?? p.text ?? '')}
        </div>
      );
    case 'List': {
      const send  = React.useContext(ChatCtx);
      const items = (p.items ?? []) as Array<{ title: string; subtitle?: string; iconName?: string; value?: string; name?: string }>;
      return (
        <div className="px-5 py-3">
          {p.heading != null && <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-medium">{String(p.heading)}</p>}
          <div className="space-y-1.5">
            {items.map((item, i) => {
              const prompt = BUTTON_PROMPTS[item.name ?? ''] ?? `Show me ${item.title}`;
              return (
                <button
                  key={i}
                  onClick={() => send(prompt)}
                  className="w-full flex items-center gap-3 bg-slate-900/40 hover:bg-slate-700/60 rounded-xl px-3 py-2.5 transition-colors text-left group"
                >
                  {item.iconName && <span className="text-lg flex-shrink-0">{ICON_MAP[item.iconName] ?? '•'}</span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition-colors">{item.title}</p>
                    {item.subtitle && <p className="text-xs text-slate-400 truncate">{item.subtitle}</p>}
                  </div>
                  {item.value
                    ? <span className="text-sm font-bold text-emerald-400 flex-shrink-0">{item.value}</span>
                    : <span className="text-slate-600 group-hover:text-slate-400 text-xs">→</span>}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'KeyValueList': {
      const items = (p.items ?? []) as Array<{ key: string; value: string }>;
      return (
        <div className="px-5 py-3 space-y-1">
          {p.heading != null && <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-medium">{String(p.heading)}</p>}
          {items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-1 border-b border-white/5 last:border-0">
              <span className="text-slate-400">{item.key}</span>
              <span className="text-white font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'StatList': {
      const stats = (p.items ?? []) as Array<{ label: string; value: string; trend?: string }>;
      return (
        <div className="px-5 py-3">
          {p.heading != null && <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-medium">{String(p.heading)}</p>}
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s, i) => (
              <div key={i} className="bg-slate-900/40 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                {s.trend && <p className={`text-xs mt-1 ${s.trend.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>{s.trend}</p>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'ButtonGroup': {
      const children = (p.children ?? []) as CrayonNode[];
      return (
        <div className={`px-5 py-4 flex gap-2 flex-wrap border-t border-white/10 ${p.variant === 'vertical' ? 'flex-col' : 'flex-row'}`}>
          {children.map((c, i) => <CrayonRender key={i} node={c} />)}
        </div>
      );
    }
    case 'Button': {
      const send    = React.useContext(ChatCtx);
      const btnName = String(p.name ?? '');
      const label   = String(p.children ?? p.label ?? '');

      const handleClick = () => {
        // 1. Try exact name match
        let prompt = BUTTON_PROMPTS[btnName];
        // 2. Try label keyword match
        if (!prompt) {
          const lc = label.toLowerCase();
          if (lc.includes('kpi') || lc.includes('dashboard') || lc.includes('overview'))
            prompt = 'Show me the full KPI dashboard';
          else if (lc.includes('vehicle') || lc.includes('fleet'))
            prompt = 'Show me all available vehicles';
          else if (lc.includes('booking') || lc.includes('dispatch'))
            prompt = 'Show me current and active bookings';
          else if (lc.includes('maintenance') || lc.includes('repair'))
            prompt = 'Show critical and high priority maintenance requests';
          else if (lc.includes('alert') || lc.includes('warning'))
            prompt = 'Show all critical alerts and warnings';
          else
            prompt = label; // send label text as-is
        }
        send(prompt);
      };

      return (
        <button
          onClick={handleClick}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
            p.variant === 'primary'
              ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:opacity-90 shadow'
              : 'bg-slate-700 border border-white/10 text-slate-200 hover:bg-slate-600'
          }`}
        >
          {p.iconLeft != null && typeof p.iconLeft  === 'object' && <span className="mr-1.5">{ICON_MAP[(p.iconLeft  as CrayonNode).props?.name as string] ?? ''}</span>}
          {label}
          {p.iconRight != null && typeof p.iconRight === 'object' && <span className="ml-1.5">{ICON_MAP[(p.iconRight as CrayonNode).props?.name as string] ?? ''}</span>}
        </button>
      );
    }
    case 'Divider':
      return <div className="border-t border-white/10 mx-5" />;
    case 'Badge':
      return <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">{String(p.label ?? p.children ?? '')}</span>;
    default:
      // Unknown component — render children if any
      if (Array.isArray(p.children)) {
        return <>{(p.children as CrayonNode[]).map((c, i) => <CrayonRender key={i} node={c} />)}</>;
      }
      return null;
  }
}

// Parse <content thesys="true">...</content> from the AI text
function parseThesysContent(text: string): { plain: string; nodes: CrayonNode[] } {
  const re = /<content[^>]*thesys[^>]*>([\s\S]*?)<\/content>/gi;
  const nodes: CrayonNode[] = [];
  const plain = text.replace(re, (_, inner) => {
    const decoded = inner
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    try {
      const parsed = JSON.parse(decoded);
      // Root may be { component, error } or just the tree
      const tree = parsed.component ?? parsed;
      if (tree && typeof tree === 'object') nodes.push(tree as CrayonNode);
    } catch { /* malformed */ }
    return '';
  }).trim();
  return { plain, nodes };
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ToolName =
  | 'showFleetStatus' | 'showVehicles' | 'showMaintenanceRequests'
  | 'showAlerts'      | 'showBookings' | 'showKPIDashboard';

interface ToolCall { name: ToolName; args: Record<string, unknown> }

interface Message {
  id:           string;
  role:         'user' | 'assistant';
  text?:        string;
  toolCall?:    ToolCall;
  thesysNodes?: CrayonNode[];
  loading?:     boolean;
}

// ── Tool renderer ─────────────────────────────────────────────────────────────
function ToolComponent({ call }: { call: ToolCall }) {
  switch (call.name) {
    case 'showFleetStatus':         return <FleetStatusCard   {...(call.args as Record<string, never>)} />;
    case 'showVehicles':            return <VehiclesCard       {...(call.args as Record<string, never>)} />;
    case 'showMaintenanceRequests': return <MaintenanceCard    {...(call.args as Record<string, never>)} />;
    case 'showAlerts':              return <AlertsCard         {...(call.args as Record<string, never>)} />;
    case 'showBookings':            return <BookingsCard       {...(call.args as Record<string, never>)} />;
    case 'showKPIDashboard':        return <KPIDashboard       {...(call.args as Record<string, never>)} />;
    default:                        return null;
  }
}

// ── Sidebar stats ─────────────────────────────────────────────────────────────
interface SidebarStats {
  totalVehicles: number; available: number; inMaintenance: number;
  openWorkOrders: number; expiringDocs: number;
}

const QUICK = [
  { icon: '🎯', label: 'Full Overview',   prompt: 'Show me the full operations dashboard' },
  { icon: '🚗', label: 'Fleet Status',    prompt: 'Show me the current fleet status' },
  { icon: '✅', label: 'Available Vehicles', prompt: 'Show me all available vehicles' },
  { icon: '🔧', label: 'Maintenance',     prompt: 'Show critical maintenance requests' },
  { icon: '⚠️', label: 'Alerts',          prompt: 'Show all critical alerts' },
  { icon: '📋', label: 'Active Bookings', prompt: 'Show active and confirmed bookings' },
  { icon: '📄', label: 'Doc Expiries',    prompt: 'Which vehicles have documents expiring soon?' },
  { icon: '🚌', label: 'Staff Buses',     prompt: 'Show staff transportation vehicles' },
];

function Sidebar({ onCommand }: { onCommand: (p: string) => void }) {
  const [stats, setStats] = useState<SidebarStats | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/fleet/stats', { cache: 'no-store' });
        if (res.ok) setStats(await res.json());
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const util = stats && stats.totalVehicles > 0
    ? Math.round(((stats.totalVehicles - stats.available) / stats.totalVehicles) * 100)
    : 0;

  return (
    <div className="w-60 flex-shrink-0 flex flex-col bg-slate-900/80 border-r border-white/10 overflow-y-auto">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-xs font-bold text-white">AI</div>
          <div>
            <p className="text-xs font-bold text-white">Ops Assistant</p>
            <p className="text-xs text-slate-500">Smart Mobility</p>
          </div>
        </div>
      </div>

      {/* Live stats */}
      <div className="px-3 py-3 border-b border-white/10 space-y-2">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Live Status</span>
        </div>
        {stats ? (
          <>
            <div className="bg-slate-800/60 rounded-xl p-3 border border-white/5">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Fleet Utilization</span>
                <span className={`font-bold ${util >= 75 ? 'text-emerald-400' : util >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{util}%</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all" style={{ width: `${util}%` }} />
              </div>
              <p className="text-xs text-slate-600 mt-1">{stats.totalVehicles} vehicles total</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { l: 'Available',  v: stats.available,       c: 'text-emerald-400', bg: 'bg-emerald-500/10', i: '✅' },
                { l: 'In Maint.', v: stats.inMaintenance,   c: 'text-amber-400',   bg: 'bg-amber-500/10',   i: '🔧' },
                { l: 'W.Orders',  v: stats.openWorkOrders,  c: 'text-orange-400',  bg: 'bg-orange-500/10',  i: '⚙️' },
                { l: 'Doc Exp.',  v: stats.expiringDocs,    c: stats.expiringDocs > 0 ? 'text-red-400' : 'text-slate-500', bg: stats.expiringDocs > 0 ? 'bg-red-500/10' : 'bg-slate-800', i: '📋' },
              ].map(s => (
                <div key={s.l} className={`rounded-lg p-2 ${s.bg} text-center border border-white/5`}>
                  <div className="text-sm">{s.i}</div>
                  <div className={`text-lg font-bold leading-none ${s.c}`}>{s.v}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{s.l}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-2 animate-pulse">
            {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-slate-800/60 rounded-xl" />)}
          </div>
        )}
      </div>

      {/* Quick commands */}
      <div className="flex-1 px-3 py-3">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-medium">Quick Commands</p>
        <div className="space-y-1">
          {QUICK.map(q => (
            <button key={q.label} onClick={() => onCommand(q.prompt)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-all border border-transparent hover:border-white/10 group text-left">
              <span className="text-sm flex-shrink-0">{q.icon}</span>
              <span className="flex-1">{q.label}</span>
              <span className="text-slate-600 group-hover:text-slate-400">→</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-white/10">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Refreshes every 30s</span>
        </div>
      </div>
    </div>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-sm flex-shrink-0 mt-1">🤖</div>
      )}
      <div className={`max-w-[82%] ${isUser ? 'order-first' : 'w-full'}`}>
        {isUser && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white shadow">
            {msg.text}
          </div>
        )}
        {!isUser && (
          <div className="space-y-3">
            {msg.loading && (
              <div className="bg-slate-800/70 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="text-xs text-slate-500">Thinking…</span>
              </div>
            )}
            {/* Plain text response */}
            {msg.text && (
              <div className="bg-slate-800/70 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-100 leading-relaxed">
                {msg.text}
              </div>
            )}
            {/* TheSys generative UI nodes — wrapped in ChatCtx so buttons can fire sendMessage */}
            {msg.thesysNodes && msg.thesysNodes.length > 0 && (
              <ChatCtx.Consumer>
                {send => (
                  <ChatCtx.Provider value={send}>
                    <div className="space-y-3">
                      {msg.thesysNodes!.map((node, i) => <CrayonRender key={i} node={node} />)}
                    </div>
                  </ChatCtx.Provider>
                )}
              </ChatCtx.Consumer>
            )}
            {/* Our custom tool components */}
            {msg.toolCall && (
              <div className="w-full">
                <ToolComponent call={msg.toolCall} />
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 border border-white/10 flex items-center justify-center text-sm flex-shrink-0 mt-1">👤</div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OperationsAssistantPage() {
  const threadId = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const hasGreeted = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput('');

    const userMsg: Message = { id: Date.now() + '-u', role: 'user', text: text.trim() };
    const aiMsg:   Message = { id: Date.now() + '-a', role: 'assistant', loading: true };

    setMessages(prev => [...prev, userMsg, aiMsg]);

    try {
      const res = await fetch('/api/operations/simple-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), threadId }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   aiText  = '';
      let   aiTool: ToolCall | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text')      aiText += evt.content;
            if (evt.type === 'tool_call') aiTool  = { name: evt.name, args: evt.args };
            if (evt.type === 'error')     aiText  = `Error: ${evt.message}`;
          } catch { /* partial line */ }
        }

        // If a <content thesys> tag has opened but not yet closed, we're mid-stream
        // on a generative UI block — suppress raw text and keep the loading state.
        const hasPartialContent =
          aiText.includes('<content') && !aiText.includes('</content>');

        const { plain, nodes } = hasPartialContent
          ? { plain: '', nodes: [] }
          : parseThesysContent(aiText);

        // Live-update the AI bubble
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id
            ? {
                ...m,
                loading:      hasPartialContent,
                text:         plain || undefined,
                thesysNodes:  nodes.length > 0 ? nodes : undefined,
                toolCall:     aiTool,
              }
            : m
        ));
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id
          ? { ...m, loading: false, text: `Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}` }
          : m
      ));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, threadId]);

  // Auto-greet on mount
  useEffect(() => {
    if (hasGreeted.current) return;
    hasGreeted.current = true;
    sendMessage('Show me the full operations dashboard');
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  return (
    <ChatCtx.Provider value={sendMessage}>
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar */}
      <Sidebar onCommand={text => sendMessage(text)} />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-slate-900/60 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">🤖</div>
            <div>
              <h1 className="text-sm font-semibold text-white">Operations AI Assistant</h1>
              <p className="text-xs text-slate-400">Real-time fleet, maintenance &amp; dispatch intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Data
            </div>
            <a href="/operations/dashboard" className="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-white/10 transition-colors">
              ← Operations Hub
            </a>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-2">
              <span className="text-4xl">🤖</span>
              <p className="text-sm">Loading operations overview…</p>
            </div>
          )}
          {messages.map(msg => <Bubble key={msg.id} msg={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Input bar — pinned to bottom */}
        <div className="flex-shrink-0 border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-4">
          <div className="flex items-end gap-3 bg-slate-800/60 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-orange-500/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about fleet status, maintenance, alerts, bookings…"
              rows={1}
              disabled={busy}
              className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 resize-none focus:outline-none disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || busy}
              className="flex-shrink-0 w-9 h-9 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl flex items-center justify-center text-white font-bold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {busy
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <span className="text-sm">↑</span>
              }
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-2 text-center">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
    </ChatCtx.Provider>
  );
}
