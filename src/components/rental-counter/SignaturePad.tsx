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
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const resizeGenRef = useRef(0);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [hasInk, setHasInk] = useState(false);

  const applyContextStyles = useCallback((ctx: CanvasRenderingContext2D, dpr: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#0f172a';
    ctx.lineWidth = 2.2;
  }, []);

  const setupOrResizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvas.width === targetWidth && canvas.height === targetHeight) {
      return;
    }

    // Preserve existing signature ink before resizing canvas dimensions
    // (e.g. when mobile browser address bar expands/collapses).
    const savedDataUrl =
      hasInkRef.current && canvas.width > 0 && canvas.height > 0
        ? canvas.toDataURL('image/png')
        : null;

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    lastSizeRef.current = { width: rect.width, height: rect.height };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    applyContextStyles(ctx, dpr);

    if (savedDataUrl && hasInkRef.current) {
      const gen = ++resizeGenRef.current;
      const img = new Image();
      img.onload = () => {
        if (gen !== resizeGenRef.current || !hasInkRef.current || !canvasRef.current) return;
        const currentCtx = canvasRef.current.getContext('2d');
        if (!currentCtx) return;
        const currentRect = canvasRef.current.getBoundingClientRect();
        currentCtx.drawImage(
          img,
          0,
          0,
          currentRect.width || rect.width,
          currentRect.height || rect.height
        );
      };
      img.src = savedDataUrl;
    }
  }, [applyContextStyles]);

  useEffect(() => {
    setupOrResizeCanvas();
    const canvas = canvasRef.current;
    let ro: ResizeObserver | null = null;
    if (canvas && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        setupOrResizeCanvas();
      });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', setupOrResizeCanvas);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', setupOrResizeCanvas);
    };
  }, [setupOrResizeCanvas]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore synthetic pointer events without capture support */
    }
    drawingRef.current = true;
    const p = getPoint(e);
    lastPoint.current = p;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
      if (!hasInkRef.current) {
        hasInkRef.current = true;
        setHasInk(true);
      }
    }
  }

  function moveStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !lastPoint.current) return;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  }

  function endStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPoint.current = null;
    if (hasInkRef.current && canvasRef.current) {
      const url = canvasRef.current.toDataURL('image/png');
      onChangeRef.current(url);
    }
  }

  function clear() {
    ++resizeGenRef.current;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    hasInkRef.current = false;
    setHasInk(false);
    onChangeRef.current(null);
  }

  return (
    <div className="space-y-2">
      {label && <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</div>}
      <div className="rounded-xl bg-white border border-slate-300 overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          style={{ height, width: '100%', display: 'block', touchAction: 'none' }}
          onPointerDown={startStroke}
          onPointerMove={moveStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={hasInk ? 'text-emerald-400 font-medium' : 'text-[var(--text-faint)]'}>
          {hasInk ? '✓ Signed' : 'Tap and draw to sign'}
        </span>
        <button
          type="button"
          onClick={clear}
          className="px-3 py-1 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] hover:opacity-80 text-xs"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
