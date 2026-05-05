'use client';

/**
 * Touch + mouse signature pad. Renders into a canvas; produces a PNG
 * data URL on save. Mobile-friendly with large clear/save controls.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  label?: string;
}

export function SignaturePad({ onChange, height = 180, label }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
  }, []);

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setupCanvas]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    setDrawing(true);
    lastPoint.current = getPoint(e);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !lastPoint.current) return;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    if (!hasInk) setHasInk(true);
  }
  function end() {
    if (!drawing) return;
    setDrawing(false);
    lastPoint.current = null;
    const url = canvasRef.current?.toDataURL('image/png') ?? null;
    if (hasInk) onChange(url);
  }
  function clear() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>}
      <div className="rounded-xl bg-white border border-slate-300 overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          style={{ height, width: '100%', display: 'block', touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={hasInk ? 'text-emerald-300' : 'text-slate-500'}>
          {hasInk ? '✓ Signed' : 'Tap and draw to sign'}
        </span>
        <button
          type="button"
          onClick={clear}
          className="px-3 py-1 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 text-xs"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
