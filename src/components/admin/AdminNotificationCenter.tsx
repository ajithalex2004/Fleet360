'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { subscribeAdminNotificationRefresh } from '@/components/admin/admin-notification-realtime';

type NotificationEventRow = {
  id: string;
  workflowId?: string | null;
  workflowInstanceId?: string | null;
  stepInstanceId?: string | null;
  tenantId?: string | null;
  channel?: string | null;
  event: string;
  severity?: string | null;
  title: string;
  message?: string | null;
  recipientEmail?: string | null;
  isRead?: boolean | null;
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
  readAt?: string | null;
};

type NotificationResponse = {
  events: NotificationEventRow[];
  unreadCount: number;
  workflowId?: string | null;
  recipientEmail?: string | null;
};

function timeAgo(value?: string | null) {
  if (!value) return 'Just now';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function eventMeta(event: string, severity?: string | null) {
  if (event.startsWith('ADMIN_APPROVAL_')) {
    return {
      icon: '✓',
      href: '/admin/approvals',
      tone: severity === 'error'
        ? 'bg-rose-50 text-rose-700 border-rose-300'
        : severity === 'success'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
          : 'bg-amber-50 text-amber-700 border-amber-300',
      label: 'Approval',
    };
  }
  return {
    icon: 'W',
    href: '/admin/workflows',
    tone: severity === 'error'
      ? 'bg-rose-50 text-rose-700 border-rose-300'
      : severity === 'success'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
        : severity === 'warning'
          ? 'bg-amber-50 text-amber-700 border-amber-300'
          : 'bg-cyan-50 text-cyan-700 border-cyan-300',
    label: 'Workflow',
  };
}

export default function AdminNotificationCenter() {
  const [open, setOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [events, setEvents] = useState<NotificationEventRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async (opts?: { unreadOnly?: boolean; silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '30',
        unreadOnly: String(opts?.unreadOnly ?? showUnreadOnly),
      });
      const res = await fetch(`/api/admin/workflows/notifications?${params.toString()}`, { cache: 'no-store' });
      const data: NotificationResponse = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setUnreadCount(Number(data.unreadCount ?? 0));
    } catch {
      setEvents([]);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [showUnreadOnly]);

  useEffect(() => {
    fetchNotifications({ silent: true });
    const timer = window.setInterval(() => {
      fetchNotifications({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchNotifications]);

  useEffect(() => {
    return subscribeAdminNotificationRefresh(() => {
      void fetchNotifications({ silent: true });
    });
  }, [fetchNotifications]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchNotifications({ silent: true });
      }
    };
    const handleFocus = () => {
      void fetchNotifications({ silent: true });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, showUnreadOnly, fetchNotifications]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const unreadRows = useMemo(() => events.filter(event => !event.isRead), [events]);

  const markRead = useCallback(async (notificationIds: string[], markAll = false) => {
    if (!notificationIds.length && !markAll) return;
    setBusyId(markAll ? '__all__' : notificationIds[0] ?? null);
    try {
      const res = await fetch('/api/admin/workflows/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markAll,
          notificationIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUnreadCount(Number(data.unreadCount ?? 0));
        setEvents(prev => prev.map(item =>
          markAll || notificationIds.includes(item.id)
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item
        ));
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(current => !current)}
        className="relative flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 shadow-lg shadow-slate-950/30 transition-all hover:border-white/20 hover:bg-slate-800"
        title="Notification Center"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-violet-300 bg-violet-100 text-base text-violet-900 shadow-sm">
          🔔
        </span>
        <div className="hidden sm:block text-left">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Inbox</p>
          <p className="text-sm font-semibold text-white">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border border-slate-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-50 w-[26rem] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="border-b border-white/10 bg-slate-900/80 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-white text-sm font-semibold">Notification Center</p>
                <p className="text-slate-500 text-xs mt-1">Workflow studio and admin approval activity, all in one inbox.</p>
              </div>
              <button
                onClick={() => fetchNotifications()}
                className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-all hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                onClick={() => setShowUnreadOnly(value => !value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${showUnreadOnly ? 'border-violet-300 bg-violet-100 text-violet-900 shadow-sm' : 'border-slate-300 bg-slate-50 text-slate-800 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900'}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${showUnreadOnly ? 'bg-violet-700' : 'bg-slate-500'}`} />
                Unread only
              </button>
              <button
                onClick={() => markRead(unreadRows.map(item => item.id), true)}
                disabled={!unreadRows.length || busyId === '__all__'}
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-all hover:border-amber-400 hover:bg-amber-100 hover:text-amber-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busyId === '__all__' ? 'Marking...' : 'Mark all read'}
              </button>
            </div>
          </div>

          <div className="max-h-[32rem] overflow-y-auto">
            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <div className="h-3 w-32 rounded bg-slate-800" />
                    <div className="mt-3 h-3 w-full rounded bg-slate-800" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl">🔕</div>
                <p className="mt-4 text-sm font-semibold text-white">No notifications</p>
                <p className="mt-1 text-xs text-slate-500">New workflow and approval events will show up here.</p>
              </div>
            ) : events.map(event => {
              const meta = eventMeta(event.event, event.severity);
              const href = event.workflowId ? `/admin/workflows?workflowId=${event.workflowId}` : meta.href;
              return (
                <div
                  key={event.id}
                  className={`border-b border-white/5 px-4 py-4 transition-all hover:bg-white/[0.03] ${event.isRead ? '' : 'bg-violet-500/[0.05]'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-bold ${meta.tone}`}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{event.title}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${meta.tone}`}>
                          {meta.label}
                        </span>
                        {!event.isRead && <span className="h-2 w-2 rounded-full bg-rose-400" />}
                      </div>
                      {event.message && (
                        <p className="mt-1 text-xs leading-5 text-slate-300">{event.message}</p>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-[11px] text-slate-500">
                          {timeAgo(event.createdAt)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={href}
                            onClick={() => setOpen(false)}
                            className="rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-[11px] font-semibold text-cyan-800 transition-all hover:border-cyan-400 hover:bg-cyan-100 hover:text-cyan-900"
                          >
                            View
                          </Link>
                          {!event.isRead && (
                            <button
                              onClick={() => markRead([event.id])}
                              disabled={busyId === event.id}
                              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-800 transition-all hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
                            >
                              {busyId === event.id ? 'Saving...' : 'Mark read'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
