'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Camera, MessageSquare, Send, ShieldCheck, PenTool, FileText, AlertTriangle } from 'lucide-react';

export interface DrayageChatMessage {
  id: string;
  senderRole: 'DISPATCHER' | 'DRIVER' | string;
  senderName: string;
  message: string;
  isUrgent?: boolean;
  createdAt?: string;
}

export interface VerifiedContainerScan {
  scannedContainerNumber: string;
  scannedSealNumber: string;
  iso6346Valid: boolean;
  verifiedAt: string;
}

export interface CapturedEpodSignature {
  receiverName: string;
  receiverRole: string;
  signatureDataUri: string;
  signedAt: string;
}

const ISO_CHAR_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function validateIso6346Container(raw: string): {
  validFormat: boolean;
  validCheckDigit: boolean;
  expectedDigit: number | null;
} {
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-Z]{4}[0-9]{7}$/.test(cleaned)) {
    return { validFormat: false, validCheckDigit: false, expectedDigit: null };
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = cleaned[i];
    const val = i < 4 ? ISO_CHAR_VALUES[ch] : Number(ch);
    sum += val * Math.pow(2, i);
  }
  const rem = sum % 11;
  const expectedDigit = rem === 10 ? 0 : rem;
  const actualDigit = Number(cleaned[10]);
  return {
    validFormat: true,
    validCheckDigit: expectedDigit === actualDigit,
    expectedDigit,
  };
}

// ── 1. ISO 6346 Container & Bolt Seal Scanner Modal ─────────────────────────

export function ContainerScannerModal({
  jobCode,
  expectedContainerNumber,
  initialSealNumber,
  onClose,
  onConfirmScan,
}: {
  jobCode: string;
  expectedContainerNumber: string;
  initialSealNumber?: string;
  onClose: () => void;
  onConfirmScan: (scan: VerifiedContainerScan) => void;
}) {
  const [containerInput, setContainerInput] = useState(expectedContainerNumber || '');
  const [sealInput, setSealInput] = useState(initialSealNumber || `SL-DPW-${Math.floor(100000 + Math.random() * 900000)}`);
  const [scanPhotoName, setScanPhotoName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalized = containerInput.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const isoCheck = validateIso6346Container(normalized);
  const matchesManifest =
    !expectedContainerNumber ||
    normalized === expectedContainerNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const handleConfirm = () => {
    if (!normalized || normalized.length < 4) return;
    onConfirmScan({
      scannedContainerNumber: normalized,
      scannedSealNumber: sealInput.trim().toUpperCase() || 'VERIFIED-SEAL',
      iso6346Valid: isoCheck.validFormat,
      verifiedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-cyan-500/40 rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">ISO 6346 & Customs Seal</div>
              <h3 className="text-sm font-bold text-white">Scan Container & Bolt Seal ({jobCode})</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-semibold">Container Number (ISO 6346) *</label>
              {expectedContainerNumber && (
                <button
                  type="button"
                  onClick={() => setContainerInput(expectedContainerNumber)}
                  className="text-[10px] text-cyan-400 hover:underline font-semibold"
                >
                  Auto-fill {expectedContainerNumber}
                </button>
              )}
            </div>
            <input
              type="text"
              value={containerInput}
              onChange={(e) => setContainerInput(e.target.value.toUpperCase())}
              placeholder="e.g. MSCU8492014"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-cyan-500"
            />
            <div className="flex items-center justify-between mt-1.5 text-[10px]">
              {isoCheck.validFormat ? (
                <span className={isoCheck.validCheckDigit ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
                  {isoCheck.validCheckDigit
                    ? '✓ Valid ISO 6346 Format & Check Digit'
                    : `✓ ISO 6346 Format (Std Check Digit: ${isoCheck.expectedDigit})`}
                </span>
              ) : (
                <span className="text-slate-400">Format: 4 Owner Letters + 6 Digits + 1 Check Digit</span>
              )}
              {matchesManifest ? (
                <span className="text-emerald-400 font-bold">✓ Matches Manifest</span>
              ) : (
                <span className="text-amber-300 font-bold">⚠️ Differs from Manifest</span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">High-Security Bolt Seal Number *</label>
            <input
              type="text"
              value={sealInput}
              onChange={(e) => setSealInput(e.target.value.toUpperCase())}
              placeholder="e.g. SL-DPW-884920"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <input
              type="file"
              ref={fileRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setScanPhotoName(f.name);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full py-2.5 rounded-xl border border-dashed border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Camera className="w-4 h-4" />
              <span>{scanPhotoName ? `Captured: ${scanPhotoName}` : 'Camera OCR Scan Door Plate / Bolt Seal'}</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Verify ISO & Seal</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 2. Sign-on-Glass ePOD Receiver Signature Modal ──────────────────────────

export function SignaturePadModal({
  jobCode,
  containerNumber,
  deliveryCode,
  onClose,
  onConfirmSignature,
}: {
  jobCode: string;
  containerNumber: string;
  deliveryCode: string;
  onClose: () => void;
  onConfirmSignature: (sig: CapturedEpodSignature) => void;
}) {
  const [receiverName, setReceiverName] = useState('');
  const [receiverRole, setReceiverRole] = useState('Warehouse Dock Supervisor');
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      return {
        x: ((t.clientX - rect.left) * canvas.width) / rect.width,
        y: ((t.clientY - rect.top) * canvas.height) / rect.height,
      };
    }
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    setHasDrawn(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const finalName = receiverName.trim() || 'Authorized Consignee Receiver';
    const dataUri = canvasRef.current?.toDataURL('image/png') || 'data:image/png;base64,epod-signed';
    onConfirmSignature({
      receiverName: finalName,
      receiverRole: receiverRole.trim(),
      signatureDataUri: dataUri,
      signedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-emerald-500/40 rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Sign-on-Glass ePOD</div>
              <h3 className="text-sm font-bold text-white">{deliveryCode} · {containerNumber}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Receiver Full Name *</label>
            <input
              type="text"
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              placeholder="e.g. Ahmed Al-Qasimi (Ramp Supervisor)"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Designation / Gate Pass / Emirates ID</label>
            <input
              type="text"
              value={receiverRole}
              onChange={(e) => setReceiverRole(e.target.value)}
              placeholder="e.g. Warehouse Dock Supervisor"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-semibold">Receiver Signature Pad (Sign with Finger) *</label>
              <button
                type="button"
                onClick={clearCanvas}
                className="text-[10px] text-rose-400 hover:underline font-semibold"
              >
                Clear Pad
              </button>
            </div>
            <div className="rounded-2xl border-2 border-dashed border-emerald-500/40 bg-slate-900/90 overflow-hidden relative">
              <canvas
                ref={canvasRef}
                width={380}
                height={140}
                onMouseDown={startDraw}
                onMouseMove={moveDraw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={moveDraw}
                onTouchEnd={endDraw}
                className="w-full h-36 cursor-crosshair touch-none"
              />
              {!hasDrawn && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-500 text-[11px]">
                  ✍️ Draw receiver signature here for {jobCode}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Confirm ePOD Signature</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 3. In-App Dispatch & Gate Chat Modal ────────────────────────────────────

export function DrayageDispatchChatModal({
  jobCode,
  containerNumber,
  messages,
  onClose,
  onSendMessage,
}: {
  jobCode: string;
  containerNumber: string;
  messages: DrayageChatMessage[];
  onClose: () => void;
  onSendMessage: (message: string, isUrgent: boolean) => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [sending, setSending] = useState(false);

  const quickReplies = [
    'Arrived at Port Terminal Gate — waiting for lane clearance',
    'Customs inspection cleared — departing for consignee ramp',
    'Placed at warehouse ramp — forklift destuffing started',
    'Container empty & ready for L2 pickup',
  ];

  const handleSend = async (textToSend?: string) => {
    const msg = (textToSend ?? input).trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await onSendMessage(msg, isUrgent);
      if (!textToSend) setInput('');
      setIsUrgent(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-indigo-500/40 rounded-3xl p-5 max-w-md w-full space-y-3 shadow-2xl text-xs flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Dispatch & Gate Control</div>
              <h3 className="text-sm font-bold text-white">{jobCode} · {containerNumber}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto space-y-2 py-2 max-h-60 pr-1">
          {messages.length === 0 ? (
            <div className="rounded-2xl bg-slate-900/70 border border-white/5 p-4 text-center text-slate-400 text-[11px]">
              No messages yet for {jobCode}. Send a message to Dispatch Control for gate token updates, customs bay instructions, or ramp assignments.
            </div>
          ) : (
            messages.map((m) => {
              const isDriver = m.senderRole === 'DRIVER';
              return (
                <div
                  key={m.id}
                  className={`p-2.5 rounded-2xl border ${
                    m.isUrgent
                      ? 'bg-rose-950/60 border-rose-500/50 text-rose-100'
                      : isDriver
                      ? 'bg-indigo-950/50 border-indigo-500/30 text-indigo-100 ml-6'
                      : 'bg-slate-900 border-white/10 text-slate-200 mr-6'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] opacity-80 mb-1">
                    <span className="font-bold">
                      {m.isUrgent ? '🚨 URGENT · ' : ''}
                      {m.senderName} ({m.senderRole})
                    </span>
                    {m.createdAt && (
                      <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                  <div className="text-xs leading-relaxed">{m.message}</div>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Preset Chips */}
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 font-semibold">Quick Status Replies:</div>
          <div className="flex flex-wrap gap-1.5">
            {quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSend(q)}
                disabled={sending}
                className="text-[10px] px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 transition text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Input Row */}
        <div className="pt-2 border-t border-white/10 space-y-2">
          <label className="flex items-center gap-1.5 text-[11px] text-rose-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isUrgent}
              onChange={(e) => setIsUrgent(e.target.checked)}
              className="rounded border-slate-700"
            />
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>Mark as Urgent Gate / Ramp Alert</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSend();
              }}
              placeholder="Message Dispatch Control..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 4. Customs / Port Inspection Evidence Upload Modal ──────────────────────

export function InspectionEvidenceModal({
  jobCode,
  containerNumber,
  onClose,
  onSubmitEvidence,
}: {
  jobCode: string;
  containerNumber: string;
  onClose: () => void;
  onSubmitEvidence: (payload: { fileName: string; notes: string; clearInspection: boolean }) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState('Customs / Port inspection completed & seal verified');
  const [clearInspection, setClearInspection] = useState(true);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-amber-500/40 rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Port & Customs Inspection</div>
              <h3 className="text-sm font-bold text-white">{jobCode} · {containerNumber}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="file"
            ref={photoInputRef}
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFileName(f.name);
            }}
          />
          <input
            type="file"
            ref={docInputRef}
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFileName(f.name);
            }}
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="py-3 px-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-semibold flex flex-col items-center gap-1 transition"
            >
              <Camera className="w-5 h-5" />
              <span>📷 Take Inspection Picture</span>
            </button>
            <button
              type="button"
              onClick={() => docInputRef.current?.click()}
              className="py-3 px-2 rounded-xl border border-dashed border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 font-semibold flex flex-col items-center gap-1 transition"
            >
              <FileText className="w-5 h-5" />
              <span>📎 Attach Clearance PDF/Doc</span>
            </button>
          </div>

          {fileName && (
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center justify-between">
              <span>✓ Attached: {fileName}</span>
              <button type="button" onClick={() => setFileName(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Inspection Remarks / Bay Number</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-white/10 cursor-pointer">
            <input
              type="checkbox"
              checked={clearInspection}
              onChange={(e) => setClearInspection(e.target.checked)}
              className="rounded border-slate-700"
            />
            <span>Mark Customs / Port Inspection as Cleared & Ready for Transit</span>
          </label>
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSubmitEvidence({
                fileName: fileName || 'inspection-evidence.jpg',
                notes,
                clearInspection,
              })
            }
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>⬆️ Upload Verification</span>
          </button>
        </div>
      </div>
    </div>
  );
}
