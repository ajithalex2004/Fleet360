'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';

/* Minimal QR encoder using Google Charts API as a zero-dep fallback.
 * For prod-grade offline rendering, swap in qrcode-svg or qrcode.react.
 * Using the Google Charts URL keeps payload tiny; the QR decodes
 * client-side from passenger phones. */
function qrUrl(text: string, sizePx = 320): string {
  return `https://chart.googleapis.com/chart?cht=qr&chs=${sizePx}x${sizePx}&chld=H|2&chl=${encodeURIComponent(text)}`;
}

export default function DriverTripQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/schedules/${id}/qr-token`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to issue QR');
      setToken(data.token);
      setExpiresAt(data.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue QR');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Tick the countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh 30s before expiry.
  useEffect(() => {
    if (!expiresAt) return;
    const msToRefresh = expiresAt - 30_000 - Date.now();
    if (msToRefresh <= 0) return;
    const t = setTimeout(() => refresh(), msToRefresh);
    return () => clearTimeout(t);
  }, [expiresAt, refresh]);

  const remainingMs = expiresAt ? expiresAt - now : 0;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60000));
  const remainingSec = Math.max(0, Math.floor((remainingMs % 60000) / 1000));

  // Build the URL passengers' phone cameras open to. The PWA recognises
  // the path and auto-opens board-flow with the token preloaded.
  const passengerUrl = token && typeof window !== 'undefined'
    ? `${window.location.origin}/bus-ops/passenger?qr=${encodeURIComponent(token)}`
    : '';

  return (
    <div className="space-y-4">
      <Link href={`/bus-ops/driver/trip/${id}`} className="text-xs text-violet-400 hover:underline">← Trip</Link>

      <div>
        <h1 className="text-2xl font-bold">Boarding QR</h1>
        <p className="text-sm text-slate-400">Show this to passengers — they scan with their phone camera.</p>
      </div>

      {loading ? (
        <div className="text-slate-500">Issuing token…</div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>
      ) : (
        <div className="rounded-2xl bg-white p-4 flex flex-col items-center">
          {passengerUrl && (
            <img src={qrUrl(passengerUrl, 320)} alt="Boarding QR" width={320} height={320} className="block" />
          )}
          <div className="text-xs text-slate-700 mt-3 font-mono break-all px-2 text-center">{passengerUrl}</div>
          <div className="text-[10px] text-slate-500 mt-2">
            Refresh in {remainingMin}m {String(remainingSec).padStart(2, '0')}s
          </div>
        </div>
      )}

      <button onClick={refresh} disabled={loading} className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50">
        Issue new QR
      </button>

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4 text-xs text-slate-400">
        Each token is valid for 15 minutes and bound to this trip. Passengers must already be on the manifest — scanning a stranger's badge does nothing.
      </div>
    </div>
  );
}
