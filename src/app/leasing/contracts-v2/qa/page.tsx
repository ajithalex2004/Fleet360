'use client';

/**
 * AI Contract Q&A — STS contracted differentiator (3 of 3).
 *
 * Pick a contract, ask anything in English or Arabic. The agent looks up
 * the contract / payments / mileage / invoices via tool calls and answers
 * with grounded data.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Sparkles, Send, ChevronLeft, MessageSquare, Wrench } from 'lucide-react';

interface Contract {
  id: string;
  contractNumber: string;
  lessee?: string;
  status?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolsCalled?: string[];
  durationMs?: number;
}

const SUGGESTED_QUESTIONS_EN = [
  'When is the next payment due?',
  'How many kilometres are left on my mileage cap?',
  'What is my outstanding balance?',
  'When does the contract expire?',
  'Show me the most recent invoices.',
  'Who is the lessee and what KYC do we have?',
];

const SUGGESTED_QUESTIONS_AR = [
  'متى موعد الدفعة القادمة؟',
  'كم كيلومتر متبقي في الحد الأقصى؟',
  'ما هو رصيدي المستحق؟',
  'متى ينتهي العقد؟',
];

export default function ContractQAPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadContracts = useCallback(async () => {
    setLoadingContracts(true);
    try {
      const res = await fetch('/api/leasing/contracts-v2');
      const data = res.ok ? await res.json() : [];
      setContracts(Array.isArray(data) ? data : []);
    } finally {
      setLoadingContracts(false);
    }
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  useEffect(() => {
    // Auto-scroll the chat to the latest message
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function handleSelectContract(id: string) {
    setContractId(id);
    setMessages([]);
  }

  async function ask(qOverride?: string) {
    const q = (qOverride ?? question).trim();
    if (!q || !contractId || busy) return;
    setQuestion('');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);

    try {
      const res = await fetch(`/api/leasing/contracts-v2/${contractId}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages(prev => [
          ...prev,
          { role: 'system', text: data.error ?? `Server returned ${res.status}` },
        ]);
        return;
      }
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer,
          toolsCalled: data.toolsCalled,
          durationMs: data.meta?.durationMs,
        },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'system', text: err instanceof Error ? err.message : 'Request failed' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const selectedContract = contracts.find(c => c.id === contractId);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4 h-[calc(100vh-100px)] flex flex-col">
      <div>
        <Link
          href="/leasing/contracts-v2"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400"
        >
          <ChevronLeft className="h-3 w-3" /> Back to contracts
        </Link>
        <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-cyan-400" />
          AI Contract Q&A
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Pick a contract, ask anything in English or Arabic. Answers are
          grounded on real data — payments, mileage, invoices, KYC.
        </p>
      </div>

      {/* Contract picker */}
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <label className="text-xs text-slate-400 mb-2 block">Contract</label>
        <select
          value={contractId}
          onChange={(e) => handleSelectContract(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
          disabled={loadingContracts}
        >
          <option value="">
            {loadingContracts ? 'Loading…' : `— Choose a contract (${contracts.length}) —`}
          </option>
          {contracts.map(c => (
            <option key={c.id} value={c.id}>
              {c.contractNumber}{c.lessee ? ` — ${c.lessee}` : ''}{c.status ? ` (${c.status})` : ''}
            </option>
          ))}
        </select>
        {selectedContract && (
          <div className="mt-2 text-xs text-emerald-300">
            ✓ Asking about <span className="font-mono">{selectedContract.contractNumber}</span>
          </div>
        )}
      </div>

      {/* Chat panel */}
      <div className="flex-1 bg-slate-800/40 border border-slate-700 rounded-xl flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-slate-500 py-8">
              <MessageSquare className="h-8 w-8 mx-auto opacity-50" />
              <p className="text-sm mt-2">
                {contractId
                  ? 'Ask anything about this contract.'
                  : 'Pick a contract above to start.'}
              </p>
            </div>
          ) : (
            messages.map((m, i) => <Bubble key={i} msg={m} />)
          )}
          {busy && (
            <div className="flex items-center gap-2 text-slate-500 text-sm pl-2">
              <span className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse" />
              <span>Thinking…</span>
            </div>
          )}
        </div>

        {/* Suggested questions */}
        {contractId && messages.length === 0 && (
          <div className="p-4 border-t border-slate-700 bg-slate-900/30">
            <div className="text-xs text-slate-500 mb-2">Try a question:</div>
            <div className="flex flex-wrap gap-2">
              {[...SUGGESTED_QUESTIONS_EN, ...SUGGESTED_QUESTIONS_AR].map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded-full bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 border border-slate-600 transition disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(); }}
          className="p-3 border-t border-slate-700 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={contractId ? 'Ask in English or Arabic…' : 'Pick a contract first…'}
            disabled={!contractId || busy}
            className="flex-1 px-4 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white placeholder-slate-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!contractId || busy || question.trim().length < 3}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
          >
            <Send className="h-4 w-4" />
            Ask
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-500 italic">
        Powered by GPT-4o-mini with live data tool-calls. Answers reference actual
        contract data — never invented numbers. Each response logs which tools
        were called for audit transparency.
      </p>
    </div>
  );
}

function Bubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') {
    return (
      <div className="rounded-lg bg-rose-900/30 border border-rose-700 p-3 text-rose-200 text-sm">
        {msg.text}
      </div>
    );
  }
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-blue-600 text-white px-4 py-2 text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-md bg-slate-700/60 text-slate-100 px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed">
          {msg.text}
        </div>
        {(msg.toolsCalled && msg.toolsCalled.length > 0) || msg.durationMs ? (
          <div className="mt-1 ml-1 flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
            {msg.toolsCalled && msg.toolsCalled.length > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="h-3 w-3" />
                {Array.from(new Set(msg.toolsCalled)).join(' · ')}
              </span>
            )}
            {msg.durationMs && <span>{msg.durationMs}ms</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
