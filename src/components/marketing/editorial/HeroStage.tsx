'use client';

import { useEffect, useRef, useState } from 'react';
import s from './HeroStage.module.css';

/**
 * "The Living Network": a tilted 3D map plane of the UAE corridor with
 * self-drawing routes, moving vehicles and a cycling AI-agent decision card.
 * Pure SVG + CSS 3D; JS only adds pointer parallax and card cycling, so the
 * server-rendered frame is complete without it. Decorative — the figure has
 * a text summary for assistive tech.
 */

const ROADS = {
  e11: 'M110 368 C200 334 250 292 300 262 S368 216 386 204 S430 164 458 142 S500 108 520 90',
  e311: 'M140 430 C236 386 300 342 360 292 S440 214 500 166 S540 132 560 118',
  ain: 'M386 204 C404 296 436 384 476 478',
  link: 'M300 262 C318 300 338 322 362 334 S420 360 452 404',
  detour: 'M300 262 C326 290 352 300 372 290 S398 242 386 204',
};

const VEHICLES: Array<{ path: keyof typeof ROADS; dur: number; begin: number; reverse?: boolean; tone: 'ink' | 'ember' }> = [
  { path: 'e11', dur: 14, begin: 0, tone: 'ink' },
  { path: 'e11', dur: 17, begin: -6, reverse: true, tone: 'ink' },
  { path: 'e311', dur: 12, begin: -3, tone: 'ink' },
  { path: 'e311', dur: 15, begin: -9, reverse: true, tone: 'ink' },
  { path: 'ain', dur: 11, begin: -2, tone: 'ink' },
  { path: 'link', dur: 9, begin: -4, reverse: true, tone: 'ink' },
  { path: 'detour', dur: 6, begin: 0, tone: 'ember' },
  { path: 'detour', dur: 6, begin: -3, tone: 'ember' },
];

// [name, x, y, label dx, label dy, anchor]
const CITIES: Array<[string, number, number, number, number, 'start' | 'end']> = [
  ['Abu Dhabi', 128, 360, -12, 24, 'start'],
  ['Jebel Ali', 300, 262, -14, 24, 'end'],
  ['Dubai', 386, 204, -14, -10, 'end'],
  ['Sharjah', 458, 142, -14, -10, 'end'],
  ['Al Ain', 476, 478, 14, 5, 'start'],
];

const EVENTS = [
  { agent: 'Routing agent', text: 'E11 closure near Jebel Ali — 14 vehicles rerouted', mode: 'Acted · 4s', tone: 'ok' },
  { agent: 'Maintenance agent', text: 'Brake wear predicted on BUS-114 — workshop slot booked', mode: 'Acted · ticket opened', tone: 'ok' },
  { agent: 'Finance agent', text: 'Credit note AED 4,200 drafted for a delayed delivery', mode: 'Awaiting approval', tone: 'warn' },
  { agent: 'Dispatch agent', text: 'Booking surge at Dubai Marina — 6 limousines reassigned', mode: 'Acted · customers notified', tone: 'ok' },
] as const;

export type HeroStats = { vehiclesLive: number; fleetUtilization: number; uptime: number; isLive: boolean };

export default function HeroStage({ stats }: { stats: HeroStats }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [eventIndex, setEventIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Cycle the agent card (skipped for reduced motion).
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Stop after two full loops so the update isn't endless (WCAG 2.2.2).
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
      setEventIndex((i) => (i + 1) % EVENTS.length);
      if (ticks >= EVENTS.length * 2) window.clearInterval(id);
    }, 4500);
    return () => window.clearInterval(id);
  }, [paused]);

  // Pointer parallax on fine pointers only; writes CSS vars, no re-render.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--px', `${(x * 8).toFixed(2)}deg`);
        el.style.setProperty('--py', `${(-y * 6).toFixed(2)}deg`);
      });
    };
    const onLeave = () => { el.style.setProperty('--px', '0deg'); el.style.setProperty('--py', '0deg'); };
    window.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
  }, []);

  const event = EVENTS[eventIndex];
  const summary = `${stats.isLive ? 'Live' : 'Illustrative'} map of the UAE corridor from Abu Dhabi to Sharjah: vehicles moving, a road closure on the E11 and an AI routing agent rerouting 14 vehicles.`;

  return (
    <div
      ref={stageRef}
      className={s.stage}
      role="img"
      aria-label={summary}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={s.scrollLayer} aria-hidden="true">
        <div className={s.tiltLayer}>
          <div className={s.plane}>
            <svg viewBox="0 0 600 600" className={s.map}>
              <defs>
                <pattern id="hs-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M40 0H0V40" fill="none" className={s.gridLine} />
                </pattern>
                {Object.entries(ROADS).map(([id, d]) => <path key={id} id={`hs-${id}`} d={d} />)}
              </defs>
              <rect width="600" height="600" fill="url(#hs-grid)" />
              <path className={s.sea} d="M0 372 C78 356 128 334 186 304 S296 232 356 194 S470 112 520 62 L548 0 H0 Z" />
              <path className={s.coast} d="M0 372 C78 356 128 334 186 304 S296 232 356 194 S470 112 520 62 L548 0" />
              <text className={s.seaLabel} x="70" y="120">ARABIAN GULF</text>

              {(['e311', 'ain', 'link'] as const).map((k) => (
                <path key={k} d={ROADS[k]} className={`${s.road} ${s.draw}`} pathLength={1} />
              ))}
              <path d={ROADS.e11} className={`${s.road} ${s.roadMain} ${s.draw}`} pathLength={1} />
              <path d={ROADS.detour} className={`${s.detour} ${s.draw} ${s.drawLate}`} pathLength={1} />

              <g className={s.closure} transform="translate(342 232)">
                <circle r="16" className={s.pulse} />
                <circle r="7" className={s.closureDot} />
                <path d="M-3 -3L3 3M3 -3L-3 3" className={s.closureX} />
              </g>
              <text className={s.tag} x="362" y="250">E11 CLOSED</text>

              {/* Moving vehicles (hidden for reduced motion). */}
              <g className={s.moving}>
                {VEHICLES.map((v, i) => (
                  <circle key={i} r={v.tone === 'ember' ? 5 : 4} className={v.tone === 'ember' ? s.vEmber : s.vInk}>
                    <animateMotion
                      dur={`${v.dur}s`}
                      begin={`${v.begin}s`}
                      repeatCount="indefinite"
                      keyPoints={v.reverse ? '1;0' : '0;1'}
                      keyTimes="0;1"
                      calcMode="linear"
                    >
                      <mpath href={`#hs-${v.path}`} />
                    </animateMotion>
                  </circle>
                ))}
              </g>
              {/* Static composed frame for reduced motion. */}
              <g className={s.still}>
                {[[220, 318], [262, 287], [420, 176], [330, 300], [440, 360], [360, 296], [380, 270]].map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={i > 4 ? 5 : 4} className={i > 4 ? s.vEmber : s.vInk} />
                ))}
              </g>

              {CITIES.map(([name, x, y, dx, dy, anchor]) => (
                <g key={name} transform={`translate(${x} ${y})`}>
                  <circle r="9" className={s.cityHalo} />
                  <circle r="4" className={s.city} />
                  <text x={dx} y={dy} textAnchor={anchor} className={s.cityLabel}>{name.toUpperCase()}</text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      <div className={`${s.chip} ${s.chipA}`} aria-hidden="true">
        <span className={s.chipLabel}>{stats.isLive ? '● Live' : '● Sample'} · Vehicles moving</span>
        <strong>{stats.vehiclesLive.toLocaleString('en-US')}</strong>
      </div>
      <div className={`${s.chip} ${s.chipB}`} aria-hidden="true">
        <span className={s.chipLabel}>Utilization · Uptime</span>
        <strong>{stats.fleetUtilization}% <i>·</i> {stats.uptime}%</strong>
      </div>

      <div className={s.agentCard} aria-hidden="true">
        <div className={s.agentHead}>
          <span className={s.agentDot} />
          <span>{event.agent}</span>
          <span className={s.agentCount}>{eventIndex + 1}/{EVENTS.length}</span>
        </div>
        <p key={eventIndex} className={s.agentText}>{event.text}</p>
        <span className={event.tone === 'ok' ? s.modeOk : s.modeWarn}>{event.mode}</span>
      </div>
    </div>
  );
}
