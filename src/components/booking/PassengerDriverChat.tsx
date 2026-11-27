'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, User, Shield, Sparkles, Phone, MapPin } from 'lucide-react';
import { ChatMessage, PASSENGER_QUICK_CHIPS } from '@/lib/omnichannel-communication';

interface PassengerDriverChatProps {
  bookingRef: string;
  driverName?: string;
  driverPhone?: string;
  vehicleModel?: string;
  vehiclePlate?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function PassengerDriverChat({
  bookingRef,
  driverName = 'Ahmed Al-Sayed',
  driverPhone = '+971 50 998 8776',
  vehicleModel = 'Lexus ES300h Executive',
  vehiclePlate = 'DXB A 10293',
  isOpen,
  onClose,
}: PassengerDriverChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/booking-portal/messages?bookingRef=${bookingRef}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMessages();
      const interval = setInterval(fetchMessages, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen, bookingRef]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text || text.trim() === '') return;

    try {
      setSending(true);
      const res = await fetch('/api/booking-portal/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingRef,
          sender: 'PASSENGER',
          senderName: 'Passenger',
          text,
        }),
      });

      if (res.ok) {
        setInputText('');
        await fetchMessages();
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-2xl z-50 flex flex-col justify-between">
      {/* ── Chat Header ── */}
      <div className="p-4 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center font-bold text-white text-base">
            👤
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--text-main)] flex items-center gap-1.5">
              {driverName}
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {vehicleModel} · <span className="font-mono text-[var(--text-muted)]">{vehiclePlate}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`tel:${driverPhone}`}
            title="Call Chauffeur"
            className="p-2 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-xl transition-colors border border-emerald-500/20"
          >
            <Phone className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded-xl hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Messages Feed ── */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((m) => {
          const isMe = m.sender === 'PASSENGER';
          const isSystem = m.sender === 'SYSTEM';

          if (isSystem) {
            return (
              <div
                key={m.id}
                className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-[11px] text-[var(--text-muted)] text-center leading-relaxed"
              >
                <Shield className="w-3.5 h-3.5 text-violet-400 inline mr-1" />
                {m.text}
              </div>
            );
          }

          return (
            <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                  isMe
                    ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-br-none'
                    : 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-[var(--border-subtle)] rounded-bl-none'
                }`}
              >
                {!isMe && (
                  <p className="text-[10px] font-bold text-violet-300 mb-0.5">{m.senderName}</p>
                )}
                <p>{m.text}</p>
              </div>
              <span className="text-[9px] text-[var(--text-faint)] mt-1 px-1">
                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Quick Status Chips & Input Box ── */}
      <div className="p-3 bg-[var(--bg-surface-hover)] border-t border-[var(--border-subtle)] space-y-2.5">
        {/* Quick Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {PASSENGER_QUICK_CHIPS.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(chip)}
              className="flex-shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full bg-[var(--bg-surface-hover)] hover:bg-violet-600/30 text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)] transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Message chauffeur or dispatch…"
            className="flex-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl px-3.5 py-2 text-xs text-[var(--input-text)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          />
          <button
            type="submit"
            disabled={sending || !inputText.trim()}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
