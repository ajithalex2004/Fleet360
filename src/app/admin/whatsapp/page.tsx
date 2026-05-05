'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WMessage {
  id: string;
  created_at: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from_number: string;
  to_number: string;
  customer_name: string | null;
  message_body: string;
  message_sid: string | null;
  status: string;
  message_type: string;
  template_name: string | null;
  module: string | null;
  intent: string | null;
  auto_replied: boolean;
  auto_reply_text: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  media_url: string | null;
}

interface Thread {
  from_number: string;
  customer_name: string | null;
  messages: WMessage[];
  lastMessage: WMessage;
  unresolvedCount: number;
  module: string | null;
  intent: string | null;
}

interface Template {
  id: string;
  template_name: string;
  display_name: string;
  category: string;
  language: string;
  body_en: string;
  body_ar: string | null;
  variables: string[];
  is_active: boolean;
  usage_count: number;
}

interface Analytics {
  kpis: {
    messagesToday: number;
    totalConversations: number;
    autoRepliedPct: number;
    resolutionRate: number;
  };
  intentBreakdown: { intent: string; count: string }[];
  moduleBreakdown: { module: string; count: string }[];
  topNumbers: { from_number: string; customer_name: string; count: string }[];
  hourlyActivity: { hour: string; count: string }[];
  dailyActivity: { day: string; inbound: string; outbound: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  INQUIRY: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  BOOKING_CONFIRMATION: 'bg-green-500/20 text-green-300 border-green-500/30',
  PAYMENT_REMINDER: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  RENEWAL_NUDGE: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  GENERAL: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const MODULE_COLORS: Record<string, string> = {
  RENTAL: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  LEASING: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  GENERAL: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const CATEGORY_COLORS: Record<string, string> = {
  BOOKING_CONFIRMATION: 'bg-green-500/20 text-green-300 border-green-500/30',
  PAYMENT_REMINDER: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  RENEWAL_NUDGE: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  INQUIRY_RESPONSE: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  GENERAL: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {label}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
}

function groupIntoThreads(messages: WMessage[]): Thread[] {
  const threadMap = new Map<string, WMessage[]>();
  for (const msg of messages) {
    const key = msg.direction === 'INBOUND' ? msg.from_number : msg.to_number;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key)!.push(msg);
  }

  const threads: Thread[] = [];
  for (const [number, msgs] of threadMap) {
    const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const lastMsg = sorted[sorted.length - 1];
    const unresolvedCount = sorted.filter(m => m.direction === 'INBOUND' && !m.resolved).length;
    threads.push({
      from_number: number,
      customer_name: sorted.find(m => m.customer_name)?.customer_name ?? null,
      messages: sorted,
      lastMessage: lastMsg,
      unresolvedCount,
      module: sorted.find(m => m.module && m.module !== 'GENERAL')?.module ?? sorted[0]?.module ?? null,
      intent: sorted.find(m => m.intent && m.intent !== 'GENERAL')?.intent ?? sorted[0]?.intent ?? null,
    });
  }

  return threads.sort((a, b) =>
    new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  );
}

// ── Tab: Live Inbox ───────────────────────────────────────────────────────────

function InboxTab() {
  const [messages, setMessages] = useState<WMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'UNRESOLVED' | 'RENTAL' | 'LEASING' | 'GENERAL'>('ALL');
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/messages?limit=200');
      const data = await res.json() as { messages: WMessage[] };
      setMessages(data.messages ?? []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    intervalRef.current = setInterval(fetchMessages, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMessages]);

  const handleResolve = async (from_number: string, resolved: boolean) => {
    await fetch('/api/whatsapp/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_number, resolved, resolved_by: 'Admin' }),
    });
    fetchMessages();
  };

  const handleReply = async (to: string) => {
    const text = replyText[to];
    if (!text?.trim()) return;
    setSending(s => ({ ...s, [to]: true }));
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message: text }),
      });
      setReplyText(r => ({ ...r, [to]: '' }));
      fetchMessages();
    } finally {
      setSending(s => ({ ...s, [to]: false }));
    }
  };

  const threads = groupIntoThreads(messages);

  const filtered = threads.filter(t => {
    if (filter === 'UNRESOLVED') return t.unresolvedCount > 0;
    if (filter === 'RENTAL') return t.module === 'RENTAL';
    if (filter === 'LEASING') return t.module === 'LEASING';
    if (filter === 'GENERAL') return t.module === 'GENERAL' || !t.module;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', 'UNRESOLVED', 'RENTAL', 'LEASING', 'GENERAL'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === f
                ? 'bg-green-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {f === 'ALL' ? `All (${threads.length})` :
             f === 'UNRESOLVED' ? `Unresolved (${threads.filter(t => t.unresolvedCount > 0).length})` :
             f}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-slate-400 text-xs">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Auto-refreshes every 30s
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500">
          <span className="text-4xl mb-3">💬</span>
          <p className="text-sm">No conversations yet</p>
          <p className="text-xs mt-1">Messages will appear here when customers contact you via WhatsApp</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(thread => {
          const isExpanded = expandedThread === thread.from_number;
          return (
            <div
              key={thread.from_number}
              className={`rounded-xl border transition-all ${
                thread.unresolvedCount > 0
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-white/10 bg-slate-900/50'
              }`}
            >
              {/* Thread Header */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/5 rounded-t-xl transition-colors"
                onClick={() => setExpandedThread(isExpanded ? null : thread.from_number)}
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {(thread.customer_name?.[0] ?? thread.from_number.slice(-2)).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-semibold text-sm truncate">
                      {thread.customer_name ?? thread.from_number}
                    </span>
                    {thread.customer_name && (
                      <span className="text-slate-500 text-xs">{thread.from_number}</span>
                    )}
                    {thread.unresolvedCount > 0 && (
                      <span className="w-5 h-5 bg-green-500 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {thread.unresolvedCount}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs truncate">{thread.lastMessage.message_body}</p>
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className="text-slate-500 text-xs">{timeAgo(thread.lastMessage.created_at)}</span>
                  <div className="flex items-center gap-1.5">
                    {thread.intent && thread.intent !== 'GENERAL' && (
                      <Badge label={thread.intent} colorClass={INTENT_COLORS[thread.intent] ?? INTENT_COLORS.GENERAL} />
                    )}
                    {thread.module && (
                      <Badge label={thread.module} colorClass={MODULE_COLORS[thread.module] ?? MODULE_COLORS.GENERAL} />
                    )}
                    {thread.unresolvedCount === 0 && (
                      <span className="text-green-400 text-xs">✓ Resolved</span>
                    )}
                  </div>
                </div>

                <span className="text-slate-600 ml-2">{isExpanded ? '▲' : '▼'}</span>
              </div>

              {/* Expanded Conversation */}
              {isExpanded && (
                <div className="border-t border-white/10">
                  {/* Chat messages */}
                  <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
                    {thread.messages.map(msg => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.direction === 'INBOUND' ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-xs lg:max-w-md rounded-2xl px-4 py-2.5 ${
                            msg.direction === 'INBOUND'
                              ? 'bg-slate-800 text-slate-100 rounded-tl-sm'
                              : 'bg-blue-600 text-white rounded-tr-sm'
                          }`}
                        >
                          {msg.template_name && (
                            <div className="text-xs opacity-60 mb-1">📋 Template: {msg.template_name}</div>
                          )}
                          <p className="text-sm whitespace-pre-wrap">{msg.message_body}</p>
                          {msg.direction === 'INBOUND' && msg.auto_replied && msg.auto_reply_text && (
                            <div className="mt-2 pt-2 border-t border-white/10 text-xs text-green-300 opacity-70">
                              🤖 Auto-replied
                            </div>
                          )}
                          <div className={`flex items-center gap-1 mt-1 text-xs opacity-50 ${msg.direction === 'OUTBOUND' ? 'justify-end' : ''}`}>
                            <span>{formatTime(msg.created_at)}</span>
                            {msg.direction === 'OUTBOUND' && (
                              <span>{msg.status === 'SENT' ? '✓✓' : msg.status === 'DELIVERED' ? '✓✓' : '✓'}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reply box + actions */}
                  <div className="p-4 border-t border-white/10 space-y-3">
                    <div className="flex gap-2">
                      <textarea
                        value={replyText[thread.from_number] ?? ''}
                        onChange={e => setReplyText(r => ({ ...r, [thread.from_number]: e.target.value }))}
                        placeholder="Type a reply..."
                        rows={2}
                        className="flex-1 bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-green-500/50 placeholder-slate-500"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && e.ctrlKey) handleReply(thread.from_number);
                        }}
                      />
                      <button
                        onClick={() => handleReply(thread.from_number)}
                        disabled={sending[thread.from_number] || !replyText[thread.from_number]?.trim()}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
                      >
                        {sending[thread.from_number] ? '...' : 'Send'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-xs">Ctrl+Enter to send</span>
                      {thread.unresolvedCount > 0 ? (
                        <button
                          onClick={() => handleResolve(thread.from_number, true)}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                          ✓ Mark Resolved
                        </button>
                      ) : (
                        <button
                          onClick={() => handleResolve(thread.from_number, false)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-slate-300 rounded-lg text-xs transition-colors"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Send Message ─────────────────────────────────────────────────────────

function SendTab() {
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'text' | 'template'>('text');
  const [freeText, setFreeText] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<'en' | 'ar' | 'both'>('en');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [recentSends, setRecentSends] = useState<WMessage[]>([]);
  const hasCredentials = true; // show warning inline

  useEffect(() => {
    fetch('/api/whatsapp/templates')
      .then(r => r.json())
      .then((d: { templates: Template[] }) => setTemplates(d.templates?.filter(t => t.is_active) ?? []));
    fetchRecent();
  }, []);

  const fetchRecent = async () => {
    try {
      const res = await fetch('/api/whatsapp/messages?direction=OUTBOUND&limit=10');
      const data = await res.json() as { messages: WMessage[] };
      setRecentSends(data.messages ?? []);
    } catch { /* noop */ }
  };

  const currentTemplate = templates.find(t => t.template_name === selectedTemplate);
  const templateVarNames: string[] = Array.isArray(currentTemplate?.variables) ? currentTemplate.variables : [];

  const previewBody = () => {
    if (mode === 'text') return freeText;
    if (!currentTemplate) return '';
    const bodyField = language === 'ar' ? (currentTemplate.body_ar ?? currentTemplate.body_en) : currentTemplate.body_en;
    let body = bodyField;
    for (const [k, v] of Object.entries(templateVars)) {
      body = body.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || `{{${k}}}`);
    }
    return body;
  };

  const handleSend = async () => {
    if (!to.trim()) { setResult({ error: 'Phone number required' }); return; }
    setSending(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { to: to.trim() };
      if (mode === 'text') {
        payload.message = freeText;
      } else {
        payload.templateName = selectedTemplate;
        payload.templateVars = templateVars;
      }

      const sends: Promise<Response>[] = [];
      if (language === 'both') {
        sends.push(
          fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, language: 'en' }) }),
          fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, language: 'ar' }) })
        );
      } else {
        sends.push(
          fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, language }) })
        );
      }

      const results = await Promise.all(sends);
      const jsons = await Promise.all(results.map(r => r.json())) as { success?: boolean; error?: string }[];
      const allOk = jsons.every(j => j.success);
      setResult(allOk ? { success: true } : { error: jsons.find(j => j.error)?.error ?? 'Send failed' });
      if (allOk) { setFreeText(''); fetchRecent(); }
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Form */}
      <div className="space-y-5">
        {/* Setup warning */}
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          ⚠️ Twilio credentials not configured? Add <code className="bg-amber-500/20 px-1 rounded">TWILIO_ACCOUNT_SID</code>,{' '}
          <code className="bg-amber-500/20 px-1 rounded">TWILIO_AUTH_TOKEN</code>, and{' '}
          <code className="bg-amber-500/20 px-1 rounded">TWILIO_WHATSAPP_NUMBER</code> to <code className="bg-amber-500/20 px-1 rounded">.env.local</code> to enable real WhatsApp sending. Messages are logged regardless.
        </div>

        {/* Phone input */}
        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">Recipient Phone Number</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-slate-800 border border-r-0 border-white/10 rounded-l-lg text-slate-400 text-sm">🇦🇪 +971</span>
            <input
              type="tel"
              value={to}
              onChange={e => setTo(e.target.value.startsWith('+') ? e.target.value : e.target.value)}
              placeholder="501234567 or +971501234567"
              className="flex-1 bg-slate-900 border border-white/10 text-white rounded-r-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50 placeholder-slate-600"
            />
          </div>
        </div>

        {/* Mode toggle */}
        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">Message Type</label>
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['text', 'template'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === m ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {m === 'text' ? '✏️ Free Text' : '📋 Template'}
              </button>
            ))}
          </div>
        </div>

        {/* Free text */}
        {mode === 'text' && (
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-2">Message</label>
            <textarea
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              rows={5}
              placeholder="Type your message..."
              className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-green-500/50 placeholder-slate-600"
            />
          </div>
        )}

        {/* Template selector */}
        {mode === 'template' && (
          <div className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Template</label>
              <select
                value={selectedTemplate}
                onChange={e => { setSelectedTemplate(e.target.value); setTemplateVars({}); }}
                className="w-full bg-slate-900 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50"
              >
                <option value="">— Select template —</option>
                {templates.map(t => (
                  <option key={t.template_name} value={t.template_name}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Variable fill-in */}
            {templateVarNames.length > 0 && (
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-2">
                  Template Variables
                  <span className="ml-2 text-slate-500 text-xs font-normal">Use {'{{variable_name}}'} syntax</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {templateVarNames.map(varName => (
                    <div key={varName}>
                      <label className="block text-slate-500 text-xs mb-1">{varName}</label>
                      <input
                        type="text"
                        value={templateVars[varName] ?? ''}
                        onChange={e => setTemplateVars(v => ({ ...v, [varName]: e.target.value }))}
                        placeholder={`{{${varName}}}`}
                        className="w-full bg-slate-800 border border-white/10 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:border-green-500/50 placeholder-slate-600"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Language toggle */}
        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">Language</label>
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['en', 'ar', 'both'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  language === l ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {l === 'en' ? '🇬🇧 English' : l === 'ar' ? '🇦🇪 Arabic' : '🌐 Both'}
              </button>
            ))}
          </div>
        </div>

        {/* Result feedback */}
        {result && (
          <div className={`p-3 rounded-lg text-sm ${result.success ? 'bg-green-500/10 border border-green-500/20 text-green-300' : 'bg-red-500/10 border border-red-500/20 text-red-300'}`}>
            {result.success ? '✅ Message sent successfully!' : `❌ ${result.error}`}
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={sending || !to.trim() || (mode === 'text' ? !freeText.trim() : !selectedTemplate)}
          className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {sending ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <span>📱</span> Send via WhatsApp
            </>
          )}
        </button>
      </div>

      {/* Right: Preview + Recent sends */}
      <div className="space-y-5">
        {/* Preview */}
        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">Message Preview</label>
          <div className="bg-slate-800 rounded-xl p-4 min-h-32 border border-white/10">
            <div className="flex justify-end">
              <div className="max-w-xs bg-green-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                {previewBody() || <span className="opacity-40 italic">Preview will appear here...</span>}
              </div>
            </div>
            <div className="flex justify-end mt-1">
              <span className="text-slate-500 text-xs">Sent · just now · ✓</span>
            </div>
          </div>
          <p className="text-slate-500 text-xs mt-1">This is how the message will appear in WhatsApp</p>
        </div>

        {/* Recent sends */}
        <div>
          <h4 className="text-slate-300 text-sm font-medium mb-3">Recent Sends</h4>
          {recentSends.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">No outbound messages yet</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentSends.map(msg => (
                <div key={msg.id} className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-blue-600/30 flex items-center justify-center text-blue-300 text-xs flex-shrink-0">
                    📤
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-300 text-xs font-medium truncate">{msg.to_number}</span>
                      <span className="text-slate-500 text-xs flex-shrink-0">{timeAgo(msg.created_at)}</span>
                    </div>
                    <p className="text-slate-400 text-xs truncate mt-0.5">{msg.message_body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${msg.status === 'SENT' ? 'text-green-400' : msg.status === 'FAILED' ? 'text-red-400' : 'text-slate-500'}`}>
                        {msg.status}
                      </span>
                      {msg.template_name && (
                        <span className="text-xs text-purple-400">📋 {msg.template_name}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Templates ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState({
    template_name: '',
    display_name: '',
    category: 'GENERAL',
    language: 'en',
    body_en: '',
    body_ar: '',
    variables: '',
  });
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/templates');
      const data = await res.json() as { templates: Template[] };
      setTemplates(data.templates ?? []);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const openNewModal = () => {
    setEditTemplate(null);
    setForm({ template_name: '', display_name: '', category: 'GENERAL', language: 'en', body_en: '', body_ar: '', variables: '' });
    setShowModal(true);
  };

  const openEditModal = (t: Template) => {
    setEditTemplate(t);
    setForm({
      template_name: t.template_name,
      display_name: t.display_name,
      category: t.category,
      language: t.language,
      body_en: t.body_en,
      body_ar: t.body_ar ?? '',
      variables: Array.isArray(t.variables) ? t.variables.join(', ') : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const vars = form.variables.split(',').map(v => v.trim()).filter(Boolean);
      if (editTemplate) {
        await fetch('/api/whatsapp/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, variables: vars }),
        });
      } else {
        await fetch('/api/whatsapp/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, body_ar: form.body_ar || undefined, variables: vars }),
        });
      }
      setShowModal(false);
      fetchTemplates();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (t: Template) => {
    await fetch('/api/whatsapp/templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_name: t.template_name, is_active: !t.is_active }),
    });
    fetchTemplates();
  };

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{templates.length} templates · {templates.filter(t => t.is_active).length} active</p>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          <span>+</span> New Template
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
        </div>
      )}

      {categories.map(category => (
        <div key={category}>
          <h4 className="text-slate-300 text-sm font-semibold mb-3 flex items-center gap-2">
            <Badge label={category} colorClass={CATEGORY_COLORS[category] ?? CATEGORY_COLORS.GENERAL} />
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.filter(t => t.category === category).map(t => (
              <div
                key={t.id}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  t.is_active ? 'border-white/10 bg-slate-900/50' : 'border-white/5 bg-slate-900/20 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white text-sm font-semibold">{t.display_name}</p>
                    <p className="text-slate-500 text-xs">{t.template_name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span title="Language">{t.language === 'ar' ? '🇦🇪' : t.language === 'both' ? '🌐' : '🇬🇧'}</span>
                  </div>
                </div>

                <p className="text-slate-400 text-xs line-clamp-3 whitespace-pre-wrap">
                  {t.body_en}
                </p>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Used {t.usage_count}×</span>
                  {Array.isArray(t.variables) && t.variables.length > 0 && (
                    <span>{t.variables.length} vars</span>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  <button
                    onClick={() => openEditModal(t)}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleToggle(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      t.is_active
                        ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300'
                        : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300'
                    }`}
                  >
                    {t.is_active ? '⏸ Disable' : '▶ Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-screen overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-white font-semibold text-lg">{editTemplate ? 'Edit Template' : 'New Template'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl transition-colors">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 text-xs font-medium mb-1">Template Name <span className="text-slate-500">(unique slug)</span></label>
                  <input
                    value={form.template_name}
                    onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))}
                    disabled={!!editTemplate}
                    className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50 disabled:opacity-50"
                    placeholder="booking_confirmation_en"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-medium mb-1">Display Name</label>
                  <input
                    value={form.display_name}
                    onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                    className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50"
                    placeholder="Booking Confirmation (English)"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 text-xs font-medium mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50"
                  >
                    {['BOOKING_CONFIRMATION', 'PAYMENT_REMINDER', 'RENEWAL_NUDGE', 'INQUIRY_RESPONSE', 'GENERAL'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 text-xs font-medium mb-1">Language</label>
                  <select
                    value={form.language}
                    onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                    className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50"
                  >
                    <option value="en">🇬🇧 English</option>
                    <option value="ar">🇦🇪 Arabic</option>
                    <option value="both">🌐 Both</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-medium mb-1">
                  English Body
                  <span className="ml-2 text-slate-500 font-normal">Use {'{{variable_name}}'} for placeholders</span>
                </label>
                <textarea
                  value={form.body_en}
                  onChange={e => setForm(f => ({ ...f, body_en: e.target.value }))}
                  rows={5}
                  className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-green-500/50"
                  placeholder="Hello {{customer_name}}! ✅ Your booking {{booking_ref}} is confirmed..."
                />
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-medium mb-1">Arabic Body <span className="text-slate-500 font-normal">(optional)</span></label>
                <textarea
                  value={form.body_ar}
                  onChange={e => setForm(f => ({ ...f, body_ar: e.target.value }))}
                  rows={4}
                  dir="rtl"
                  className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-green-500/50"
                  placeholder="مرحباً {{customer_name}}! ✅ تم تأكيد حجزك..."
                />
              </div>

              <div>
                <label className="block text-slate-300 text-xs font-medium mb-1">
                  Variables <span className="text-slate-500 font-normal">(comma-separated names)</span>
                </label>
                <input
                  value={form.variables}
                  onChange={e => setForm(f => ({ ...f, variables: e.target.value }))}
                  className="w-full bg-slate-800 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500/50"
                  placeholder="customer_name, booking_ref, vehicle_name, pickup_date"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.template_name || !form.display_name || !form.body_en}
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
              >
                {saving ? 'Saving...' : (editTemplate ? 'Save Changes' : 'Create Template')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Analytics ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/whatsapp/analytics')
      .then(r => r.json())
      .then((d: Analytics) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-slate-500 text-sm text-center py-12">Failed to load analytics</p>;
  }

  const { kpis, intentBreakdown, moduleBreakdown, topNumbers, hourlyActivity } = data;

  const intentTotal = intentBreakdown.reduce((s, r) => s + parseInt(r.count, 10), 0);
  const maxHourly = Math.max(...hourlyActivity.map(h => parseInt(h.count, 10)), 1);

  // Build hourly grid (0-23)
  const hourlyGrid = Array.from({ length: 24 }, (_, i) => {
    const row = hourlyActivity.find(h => parseInt(h.hour, 10) === i);
    return { hour: i, count: parseInt(row?.count ?? '0', 10) };
  });

  const kpiItems = [
    { label: 'Messages Today', value: kpis.messagesToday, icon: '💬', color: 'from-green-500 to-emerald-600' },
    { label: 'Total Conversations', value: kpis.totalConversations, icon: '👥', color: 'from-blue-500 to-blue-600' },
    { label: 'Auto-replied', value: `${kpis.autoRepliedPct}%`, icon: '🤖', color: 'from-purple-500 to-purple-600' },
    { label: 'Resolution Rate', value: `${kpis.resolutionRate}%`, icon: '✅', color: 'from-amber-500 to-amber-600' },
  ];

  const intentColorList = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-amber-500', 'bg-slate-500'];
  const moduleColorList = ['bg-cyan-500', 'bg-indigo-500', 'bg-slate-500'];

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiItems.map(item => (
          <div key={item.label} className="bg-slate-900/70 border border-white/10 rounded-xl p-5">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-xl mb-3`}>
              {item.icon}
            </div>
            <p className="text-2xl font-bold text-white">{item.value}</p>
            <p className="text-slate-400 text-xs mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Intent Breakdown */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Intent Breakdown</h3>
          {intentBreakdown.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-3">
              {intentBreakdown.map((row, i) => {
                const count = parseInt(row.count, 10);
                const pct = intentTotal > 0 ? Math.round((count / intentTotal) * 100) : 0;
                return (
                  <div key={row.intent}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-300 text-sm">{row.intent || 'Unknown'}</span>
                      <span className="text-slate-400 text-xs">{count} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${intentColorList[i % intentColorList.length]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Module Breakdown */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Module Breakdown</h3>
          {moduleBreakdown.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-3">
              {moduleBreakdown.map((row, i) => {
                const count = parseInt(row.count, 10);
                const total = moduleBreakdown.reduce((s, r) => s + parseInt(r.count, 10), 0);
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={row.module}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-300 text-sm">{row.module || 'Unknown'}</span>
                      <span className="text-slate-400 text-xs">{count} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${moduleColorList[i % moduleColorList.length]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 Phone Numbers */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Top Customers by Messages</h3>
          {topNumbers.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-3">
              {topNumbers.map((row, i) => (
                <div key={row.from_number} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{row.customer_name || row.from_number}</p>
                    {row.customer_name && <p className="text-slate-500 text-xs">{row.from_number}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-green-400 font-semibold text-sm">{row.count}</span>
                    <span className="text-slate-500 text-xs">msgs</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Messages by Hour */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-1">Messages by Hour (Last 7 days)</h3>
          <p className="text-slate-500 text-xs mb-4">Peak activity hours</p>
          <div className="flex items-end gap-0.5 h-28">
            {hourlyGrid.map(({ hour, count }) => {
              const heightPct = maxHourly > 0 ? (count / maxHourly) * 100 : 0;
              const isAM = hour < 12;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1 group">
                  <div
                    className="w-full rounded-t bg-green-500/70 group-hover:bg-green-400 transition-colors relative"
                    style={{ height: `${Math.max(heightPct, count > 0 ? 4 : 0)}%` }}
                    title={`${hour}:00 — ${count} msgs`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-slate-600 text-xs mt-1">
            <span>12am</span>
            <span>6am</span>
            <span>12pm</span>
            <span>6pm</span>
            <span>11pm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = 'inbox' | 'send' | 'templates' | 'analytics';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'inbox', label: 'Live Inbox', icon: '📥' },
  { id: 'send', label: 'Send Message', icon: '📤' },
  { id: 'templates', label: 'Templates', icon: '📋' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
];

export default function WhatsAppConsolePage() {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');

  return (
    <div className="min-h-full space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">WhatsApp AI Support Console</h1>
            <p className="text-slate-400 text-sm mt-0.5">Smart Mobility customer support via WhatsApp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 border border-white/10 text-slate-300 text-xs font-medium">
            <span className="w-2 h-2 bg-red-400 rounded-full" />
            Powered by Twilio
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-xs font-medium">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Webhook Active
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-900/50 rounded-xl border border-white/10 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-green-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'inbox' && <InboxTab />}
        {activeTab === 'send' && <SendTab />}
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
