'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

/* ── Method capability detection ──────────────────────────────────────── */

type Capability = 'available' | 'unsupported' | 'unknown';

interface BluetoothFingerprint {
  bluetooth?: {
    requestDevice: (options: unknown) => Promise<unknown>;
  };
}
interface NDEFReaderCtor { new(): { scan: () => Promise<void>; addEventListener: (e: string, cb: (ev: unknown) => void) => void }; }

function detectBLE(): Capability {
  if (typeof navigator === 'undefined') return 'unknown';
  return (navigator as unknown as BluetoothFingerprint).bluetooth ? 'available' : 'unsupported';
}
function detectNFC(): Capability {
  if (typeof window === 'undefined') return 'unknown';
  return 'NDEFReader' in window ? 'available' : 'unsupported';
}

/* ── BLE proximity check (Web Bluetooth) ──────────────────────────────── */

async function tryBleProximity(beaconUuid: string, signal: AbortSignal): Promise<{ ok: boolean; rssi?: number; reason?: string }> {
  if (typeof navigator === 'undefined' || !(navigator as unknown as BluetoothFingerprint).bluetooth) {
    return { ok: false, reason: 'Web Bluetooth not supported on this device.' };
  }
  try {
    const requestDevice = (navigator as unknown as { bluetooth: { requestDevice: (o: unknown) => Promise<unknown> } }).bluetooth.requestDevice;
    // Web Bluetooth: filter on the registered service UUID.
    const device = await requestDevice({
      filters: [{ services: [beaconUuid] }],
      optionalServices: [beaconUuid],
    }) as { name?: string; gatt?: { connect: () => Promise<unknown> } };

    if (signal.aborted) return { ok: false, reason: 'Cancelled' };
    // Reaching here means the OS confirmed a nearby device matching the
    // beacon's service UUID. We treat that as proof of proximity.
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'BLE scan failed' };
  }
}

/* ── NFC tag read (Web NFC) ───────────────────────────────────────────── */

async function tryNfcRead(signal: AbortSignal): Promise<{ ok: boolean; tagUid?: string; reason?: string }> {
  if (typeof window === 'undefined' || !('NDEFReader' in window)) {
    return { ok: false, reason: 'Web NFC not supported on this device.' };
  }
  try {
    const Reader = (window as unknown as { NDEFReader: NDEFReaderCtor }).NDEFReader;
    const reader = new Reader();
    await reader.scan();
    return await new Promise(resolve => {
      const handler = (ev: unknown) => {
        const r = ev as { serialNumber?: string };
        if (r.serialNumber) {
          resolve({ ok: true, tagUid: r.serialNumber });
        } else {
          resolve({ ok: false, reason: 'Tag had no serial number' });
        }
      };
      reader.addEventListener('reading', handler);
      signal.addEventListener('abort', () => resolve({ ok: false, reason: 'Cancelled' }));
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'NFC read failed' };
  }
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function BoardInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const passengerId = sp.get('passengerId') ?? '';
  const scheduleId = sp.get('scheduleId') ?? '';
  const beaconUuid = sp.get('beacon');
  const qrToken = sp.get('qrToken');

  const [bleCap, setBleCap] = useState<Capability>('unknown');
  const [nfcCap, setNfcCap] = useState<Capability>('unknown');
  const [stage, setStage] = useState<'idle' | 'ble' | 'nfc' | 'manual' | 'submitting' | 'done' | 'error'>('idle');
  const [stageMsg, setStageMsg] = useState<string>('');
  const [employeeId, setEmployeeId] = useState('');

  useEffect(() => {
    setBleCap(detectBLE());
    setNfcCap(detectNFC());
    if (typeof window !== 'undefined') {
      setEmployeeId(localStorage.getItem('busPassengerEmployeeId') ?? '');
    }
  }, []);

  // QR deep-link path: token comes in via the URL after the camera scan.
  // Auto-fire QR check-in once the page is ready.
  useEffect(() => {
    if (!qrToken || stage !== 'idle') return;
    setStage('submitting');
    setStageMsg('Verifying QR token…');
    fetch('/api/bus-ops/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'QR', token: qrToken, scheduleId, passengerId, direction: 'BOARD',
        staffEmployeeId: typeof window !== 'undefined' ? localStorage.getItem('busPassengerEmployeeId') : null,
      }),
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? 'Check-in failed');
        setStage('done');
        setStageMsg('✓ Boarded — have a good ride.');
        setTimeout(() => router.push('/bus-ops/passenger'), 1500);
      })
      .catch(err => {
        setStage('error');
        setStageMsg(err instanceof Error ? err.message : 'QR check-in failed');
      });
  }, [qrToken, stage, scheduleId, passengerId, router]);

  const submit = useCallback(async (payload: Record<string, unknown>) => {
    setStage('submitting');
    setStageMsg('Recording check-in…');
    try {
      const res = await fetch('/api/bus-ops/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, scheduleId, passengerId, direction: 'BOARD' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Check-in failed');
      setStage('done');
      setStageMsg('✓ Boarded — have a good ride.');
      setTimeout(() => router.push('/bus-ops/passenger'), 1500);
    } catch (err) {
      setStage('error');
      setStageMsg(err instanceof Error ? err.message : 'Check-in failed');
    }
  }, [scheduleId, passengerId, router]);

  const startBle = async () => {
    if (!beaconUuid) {
      setStage('error');
      setStageMsg('No beacon registered for this trip\'s vehicle. Use NFC or manual.');
      return;
    }
    setStage('ble');
    setStageMsg('Scanning for the bus beacon… select it in the dialog.');
    const ctrl = new AbortController();
    const result = await tryBleProximity(beaconUuid, ctrl.signal);
    if (!result.ok) {
      setStage('error');
      setStageMsg(`BLE: ${result.reason ?? 'unable to detect bus'}`);
      return;
    }
    await submit({ method: 'BLE', beaconUuid, staffMemberId: undefined, rssi: result.rssi });
  };

  const startNfc = async () => {
    setStage('nfc');
    setStageMsg('Hold your phone over the bus reader…');
    const ctrl = new AbortController();
    const result = await tryNfcRead(ctrl.signal);
    if (!result.ok || !result.tagUid) {
      setStage('error');
      setStageMsg(`NFC: ${result.reason ?? 'no tag read'}`);
      return;
    }
    // For passenger-side NFC, the tag UID is the passenger's own RFID badge
    // tapped against the bus reader. Server resolves staff via the tag.
    await submit({ method: 'NFC', tagUid: result.tagUid });
  };

  const startManual = async () => {
    if (!confirm('Confirm you are at the bus stop and boarding now?')) return;
    await submit({ method: 'MANUAL' });
  };

  if (!passengerId || !scheduleId) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">Missing trip context.</div>
        <Link href="/bus-ops/passenger" className="block text-center py-3 rounded-xl border border-white/10">← My Bus</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/bus-ops/passenger" className="text-xs text-cyan-400 hover:underline">← My Bus</Link>

      <div>
        <h1 className="text-2xl font-bold">Board the Bus</h1>
        <p className="text-sm text-slate-400">Pick a method. BLE + NFC are the fastest if your phone supports them.</p>
      </div>

      {stage !== 'idle' && (
        <div className={`p-4 rounded-2xl border ${
          stage === 'done'   ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-100'
          : stage === 'error'? 'bg-rose-500/20 border-rose-500/40 text-rose-100'
          : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-100'
        }`}>
          <div className="text-sm">{stageMsg}</div>
          {(stage === 'ble' || stage === 'nfc' || stage === 'submitting') && (
            <div className="mt-2 h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-white/40 animate-pulse" />
            </div>
          )}
        </div>
      )}

      <MethodCard
        title="📡 BLE Proximity"
        sub={beaconUuid
          ? (bleCap === 'available' ? 'Auto-detect the bus beacon — fastest' : 'Web Bluetooth not supported on this browser')
          : 'No beacon registered for this trip\'s vehicle'}
        accent="violet"
        disabled={bleCap !== 'available' || !beaconUuid || stage === 'submitting'}
        onClick={startBle}
      />

      <MethodCard
        title="📲 NFC / RFID"
        sub={nfcCap === 'available' ? 'Tap your staff badge against the bus reader' : 'Web NFC not supported (iOS Safari does not support it)'}
        accent="emerald"
        disabled={nfcCap !== 'available' || stage === 'submitting'}
        onClick={startNfc}
      />

      <MethodCard
        title="✋ Manual Tap"
        sub="I confirm I am at the bus stop and boarding now"
        accent="amber"
        disabled={stage === 'submitting'}
        onClick={startManual}
      />

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4 text-xs text-slate-400 space-y-1">
        <p className="text-white font-semibold">Method support on your device</p>
        <p>BLE: {bleCap === 'available' ? '✓ supported' : '✗ not available'} {!beaconUuid && bleCap === 'available' && '· no beacon for this bus'}</p>
        <p>NFC: {nfcCap === 'available' ? '✓ supported' : '✗ not available (iOS limitation)'}</p>
        <p>Manual: ✓ always available</p>
        {employeeId && <p className="mt-1 text-slate-500">Linked to {employeeId}</p>}
      </div>
    </div>
  );
}

function MethodCard({ title, sub, accent, disabled, onClick }: { title: string; sub: string; accent: 'violet' | 'emerald' | 'amber'; disabled: boolean; onClick: () => void }) {
  const accentMap: Record<string, string> = {
    violet:  'from-violet-600 to-purple-600',
    emerald: 'from-emerald-600 to-teal-600',
    amber:   'from-amber-600 to-orange-600',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`block w-full text-left bg-gradient-to-r ${accentMap[accent]} rounded-2xl p-5 disabled:opacity-40 disabled:grayscale active:scale-95 transition-transform shadow-lg`}
    >
      <div className="text-lg font-bold">{title}</div>
      <div className="text-xs text-white/80 mt-0.5">{sub}</div>
    </button>
  );
}

export default function PassengerBoardPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
      <BoardInner />
    </Suspense>
  );
}
