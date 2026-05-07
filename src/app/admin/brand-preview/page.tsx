'use client';

/**
 * /admin/brand-preview — Dark + Gold & Blue brand-framing showcase.
 *
 * Self-contained preview page. Uses arbitrary hex via Tailwind's
 * bg-[#...] classes plus inline style for gradients, so it doesn't
 * depend on extending tailwind.config.* — easy to dispose of if the
 * direction isn't right.
 *
 * Compare this against /platform/v2 (current modern home) and
 * /platform (classic) to evaluate the gold/blue palette before
 * rolling it out system-wide via tailwind.config + page-theme.tsx.
 */

import React from 'react';
import {
  Sparkles, ArrowUpRight, Banknote, Activity, AlertTriangle, CheckCircle2,
  Siren, Car, Wrench, Truck, Bus, School, Bot, BarChart3, Users, UserCog,
  Building2, Smartphone, Radio, Leaf, Package, ChevronRight, RefreshCw, Plus,
  ListChecks, Search,
} from 'lucide-react';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:           '#08152e',  // very deep, almost black-navy
  surface:      'rgba(255,255,255,0.03)',
  border:       'rgba(255,255,255,0.08)',

  gold:         '#D4AF37',  // primary
  goldBright:   '#E8C547',  // highlight
  goldDeep:     '#B8860B',  // pressed / dark
  goldTint10:   'rgba(212,175,55,0.10)',
  goldTint20:   'rgba(212,175,55,0.20)',
  goldGlow:     'rgba(212,175,55,0.30)',

  blue:         '#3B82F6',  // partner
  blueBright:   '#60A5FA',
  blueTint10:   'rgba(59,130,246,0.10)',
  blueTint20:   'rgba(59,130,246,0.20)',
  blueGlow:     'rgba(59,130,246,0.30)',
};

export default function BrandPreviewPage() {
  return (
    <div className="relative -m-6 lg:-m-8 min-h-[calc(100vh-4rem)]" style={{ background: C.bg, color: 'white' }}>
      <BackgroundMesh />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl border-b" style={{ background: 'rgba(0,0,0,0.4)', borderColor: C.border }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDeep} 100%)`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 8px 24px -4px ${C.goldGlow}`,
              }}>
              <Sparkles className="w-4 h-4" style={{ color: '#1a1300' }} />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold tracking-tight">XL <span style={{ color: C.gold }}>AI</span></div>
              <div className="text-[10px] -mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Smart Mobility</div>
            </div>
          </div>

          <div className="flex-1 max-w-md mx-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                placeholder="Search anything…"
                className="w-full rounded-xl pl-10 pr-12 py-2 text-sm placeholder-slate-500 focus:outline-none transition-all"
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                }}
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border rounded px-1.5 py-0.5"
                style={{ borderColor: C.border, background: 'rgba(255,255,255,0.03)' }}>⌘K</kbd>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ButtonGhost icon={ListChecks}>Approvals</ButtonGhost>
            <ButtonPrimary icon={Plus}>New booking</ButtonPrimary>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Banner */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full backdrop-blur"
            style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)' }}>
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] font-medium text-emerald-300">All systems operational</span>
          </div>
          <button className="inline-flex items-center gap-1.5 text-[11px] hover:text-white transition-colors px-2.5 py-1 rounded-md"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            <RefreshCw className="w-3 h-3" /> 14:32
          </button>
        </div>

        {/* ── Hero pulse cards ─────────────────────────────────────────── */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PulseCard tone="gold" label="Revenue · last 30 days" value="AED 47,210"
            sub="124 unpaid · 3 overdue" Icon={Banknote} />
          <PulseCard tone="blue" label="Fleet utilisation" value="73%"
            sub="142/195 dispatched · 53 available" Icon={Activity} />
        </section>

        {/* ── 3-column decision panel ──────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <GlassPanel title="Needs attention" Icon={AlertTriangle} accent="rose" count={3}>
            <ul className="space-y-2">
              {[
                { Icon: Siren,    label: '2 escalated incidents', sub: 'Critical priority',     tone: 'rose' },
                { Icon: Car,      label: '3 returns overdue',     sub: 'Rent-a-Car · contact',  tone: 'amber' },
                { Icon: Banknote, label: '5 overdue invoices',    sub: 'Trigger collections',   tone: 'amber' },
              ].map(a => (
                <li key={a.label}>
                  <a href="#"
                    className="group flex items-center gap-3 p-3 rounded-xl transition-all"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = C.border; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      a.tone === 'rose' ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300'
                    }`} style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
                      <a.Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">{a.label}</div>
                      <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{a.sub}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                  </a>
                </li>
              ))}
            </ul>
          </GlassPanel>

          <GlassPanel title="In progress" Icon={Activity} accent="blue" count={87}>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Logistics',  value: 14, sub: '47 delivered today',  Icon: Truck, tone: 'gold' },
                { label: 'Staff bus',  value: 47, sub: '12 active routes',    Icon: Bus,   tone: 'blue' },
                { label: 'RAC active', value: 21, sub: '32 cars available',   Icon: Car,   tone: 'gold' },
                { label: 'Drivers',    value: 89, sub: 'of 124 total',        Icon: UserCog, tone: 'blue' },
              ].map(p => (
                <a key={p.label} href="#"
                  className="group p-3 rounded-xl transition-all"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = C.border; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                  <div className="flex items-center gap-2 mb-1">
                    <p.Icon className="w-3.5 h-3.5" style={{ color: p.tone === 'gold' ? C.gold : C.blueBright }} />
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">{p.value}</div>
                  <div className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.sub}</div>
                </a>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel title="Quick actions" Icon={Sparkles} accent="gold">
            <div className="space-y-2">
              {[
                { label: 'Create booking',      Icon: Plus },
                { label: 'Add vehicle',         Icon: Car },
                { label: 'Add driver',          Icon: UserCog },
                { label: 'Open dispatch board', Icon: Radio },
              ].map(q => (
                <a key={q.label} href="#"
                  className="group flex items-center gap-3 p-3 rounded-xl transition-all"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = C.border; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${C.goldTint20}, ${C.blueTint20})`,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                    }}>
                    <q.Icon className="w-4 h-4" style={{ color: C.gold }} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-white">{q.label}</span>
                  <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                </a>
              ))}
            </div>
          </GlassPanel>
        </section>

        {/* ── Module dock (compact) ────────────────────────────────────── */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Modules · 14
          </div>
          <div className="rounded-2xl p-3 backdrop-blur-xl"
            style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {([
                { Icon: Bot,        label: 'AI Agents',      tone: 'gold' },
                { Icon: Car,        label: 'Fleet',          tone: 'gold' },
                { Icon: Wrench,     label: 'Maintenance',    tone: 'blue' },
                { Icon: Truck,      label: 'Logistics',      tone: 'gold' },
                { Icon: Bus,        label: 'Staff Bus',      tone: 'blue' },
                { Icon: School,     label: 'School Bus',     tone: 'gold' },
                { Icon: Siren,      label: 'Incidents',      tone: 'rose' },
                { Icon: UserCog,    label: 'Drivers',        tone: 'blue' },
                { Icon: Building2,  label: 'Customers',      tone: 'blue' },
                { Icon: Smartphone, label: 'Bookings',       tone: 'gold' },
                { Icon: Radio,      label: 'Dispatch',       tone: 'blue' },
                { Icon: Banknote,   label: 'Finance',        tone: 'gold' },
                { Icon: Leaf,       label: 'Sustainability', tone: 'blue' },
                { Icon: Package,    label: 'Assets',         tone: 'gold' },
              ] as const).map(m => <ModuleTile key={m.label} {...m} />)}
            </div>
          </div>
        </section>

        {/* ── Sample widgets ───────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassPanel title="Buttons" Icon={Sparkles} accent="gold">
            <div className="flex flex-wrap gap-2">
              <ButtonPrimary icon={Plus}>Primary</ButtonPrimary>
              <ButtonSecondary icon={ListChecks}>Secondary</ButtonSecondary>
              <ButtonGhost icon={RefreshCw}>Ghost</ButtonGhost>
              <ButtonDanger icon={AlertTriangle}>Destructive</ButtonDanger>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <input
                placeholder="Sample input…"
                className="flex-1 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none transition-all"
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 2px ${C.goldTint20}`; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.05)'; }}
              />
              <ButtonPrimary>Apply</ButtonPrimary>
            </div>
          </GlassPanel>

          <GlassPanel title="Status pills" Icon={CheckCircle2} accent="blue">
            <div className="flex flex-wrap gap-2">
              <Pill tone="success">ACTIVE</Pill>
              <Pill tone="info">SCHEDULED</Pill>
              <Pill tone="warn">PENDING</Pill>
              <Pill tone="danger">CANCELLED</Pill>
              <Pill tone="gold">PREMIUM</Pill>
              <Pill tone="blue">VERIFIED</Pill>
              <Pill tone="muted">COMPLETED</Pill>
            </div>
          </GlassPanel>
        </section>

        {/* ── Palette swatches ─────────────────────────────────────────── */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Palette
          </div>
          <div className="rounded-2xl p-5 backdrop-blur-xl"
            style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              <Swatch label="Background"    color={C.bg} />
              <Swatch label="Gold"          color={C.gold} />
              <Swatch label="Gold bright"   color={C.goldBright} />
              <Swatch label="Gold deep"     color={C.goldDeep} />
              <Swatch label="Blue"          color={C.blue} />
              <Swatch label="Blue bright"   color={C.blueBright} />
            </div>
          </div>
        </section>

        <footer className="text-center text-[11px] pt-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Brand preview — compare against{' '}
          <a href="/platform/v2" className="hover:text-white" style={{ color: C.gold }}>/platform/v2</a>
          {' · '}
          <a href="/platform" className="hover:text-white" style={{ color: C.blueBright }}>/platform</a>
          {' · then decide whether to roll out via tailwind.config + page-theme.tsx.'}
        </footer>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function BackgroundMesh() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[120px]"
        style={{ background: C.goldTint10 }} />
      <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full blur-[120px]"
        style={{ background: C.blueTint10 }} />
      <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full blur-[140px]"
        style={{ background: C.goldTint10 }} />
    </div>
  );
}

function PulseCard({ tone, label, value, sub, Icon }: { tone: 'gold' | 'blue'; label: string; value: string; sub: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }) {
  const accent = tone === 'gold' ? C.gold : C.blueBright;
  const tint   = tone === 'gold' ? C.goldTint10 : C.blueTint10;
  const glow   = tone === 'gold' ? C.goldGlow   : C.blueGlow;
  return (
    <a href="#"
      className="group relative overflow-hidden rounded-3xl backdrop-blur-xl p-6 transition-all block"
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px -12px rgba(0,0,0,0.4)`,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent + '66'; e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 48px -12px rgba(0,0,0,0.4), 0 0 32px -8px ${glow}`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border;       e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px -12px rgba(0,0,0,0.4)`; }}>
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: tint, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
          <Icon className="w-5 h-5" />
        </div>
        <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
      </div>
      <div className="text-[11px] uppercase tracking-wider font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</div>
      <div className="text-4xl font-black tabular-nums tracking-tight mb-1.5"
        style={{ color: tone === 'gold' ? accent : 'white', textShadow: `0 0 24px ${glow}` }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </a>
  );
}

function GlassPanel({ title, Icon, accent, count, children }: { title: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: 'gold' | 'blue' | 'rose'; count?: number; children: React.ReactNode }) {
  const c = accent === 'gold' ? C.gold : accent === 'blue' ? C.blueBright : '#fda4af';
  const tint = accent === 'gold' ? C.goldTint10 : accent === 'blue' ? C.blueTint10 : 'rgba(244,63,94,0.10)';
  return (
    <div className="rounded-3xl backdrop-blur-xl p-5"
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 48px -12px rgba(0,0,0,0.4)',
      }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4" style={{ color: c }} />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: tint, color: c }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ModuleTile({ Icon, label, tone }: { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; tone: 'gold' | 'blue' | 'rose' }) {
  const color = tone === 'gold' ? C.gold : tone === 'blue' ? C.blueBright : '#fda4af';
  const tint  = tone === 'gold' ? C.goldTint10 : tone === 'blue' ? C.blueTint10 : 'rgba(244,63,94,0.10)';
  return (
    <a href="#"
      className="group flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = C.border; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'transparent'; }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
        style={{ background: tint, color, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-[10px] text-center leading-tight font-medium group-hover:text-white" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
    </a>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────
type BtnProps = { icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode; onClick?: () => void };

function ButtonPrimary({ icon: Icon, children, onClick }: BtnProps) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all"
      style={{
        background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDeep} 100%)`,
        color: '#1a1300',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 24px -4px ${C.goldGlow}`,
      }}
      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
      onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}
function ButtonSecondary({ icon: Icon, children, onClick }: BtnProps) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all"
      style={{
        background: `linear-gradient(135deg, ${C.blue} 0%, #1e40af 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.20), 0 8px 24px -4px ${C.blueGlow}`,
      }}
      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
      onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}
function ButtonGhost({ icon: Icon, children, onClick }: BtnProps) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={{ color: 'rgba(255,255,255,0.7)' }}
      onMouseEnter={e => { e.currentTarget.style.color = 'white'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; e.currentTarget.style.background = 'transparent'; }}>
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}
function ButtonDanger({ icon: Icon, children, onClick }: BtnProps) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all"
      style={{
        background: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.20), 0 8px 24px -4px rgba(244,63,94,0.30)',
      }}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

// ── Pill ─────────────────────────────────────────────────────────────────────
function Pill({ tone, children }: { tone: 'success' | 'info' | 'warn' | 'danger' | 'muted' | 'gold' | 'blue'; children: React.ReactNode }) {
  const map = {
    success: { bg: 'rgba(16,185,129,0.20)', fg: '#6ee7b7', bd: 'rgba(16,185,129,0.40)' },
    info:    { bg: 'rgba(59,130,246,0.20)', fg: '#93c5fd', bd: 'rgba(59,130,246,0.40)' },
    warn:    { bg: 'rgba(245,158,11,0.20)', fg: '#fcd34d', bd: 'rgba(245,158,11,0.40)' },
    danger:  { bg: 'rgba(244,63,94,0.20)',  fg: '#fda4af', bd: 'rgba(244,63,94,0.40)' },
    muted:   { bg: 'rgba(100,116,139,0.20)', fg: '#cbd5e1', bd: 'rgba(100,116,139,0.40)' },
    gold:    { bg: C.goldTint20, fg: C.goldBright, bd: 'rgba(212,175,55,0.40)' },
    blue:    { bg: C.blueTint20, fg: C.blueBright, bd: 'rgba(59,130,246,0.40)' },
  }[tone];
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide"
      style={{ background: map.bg, color: map.fg, border: `1px solid ${map.bd}` }}>
      {children}
    </span>
  );
}

// ── Swatch ───────────────────────────────────────────────────────────────────
function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${C.border}` }}>
      <div className="h-16 w-full" style={{ background: color }} />
      <div className="px-3 py-2" style={{ background: 'rgba(0,0,0,0.4)' }}>
        <div className="text-xs font-semibold text-white">{label}</div>
        <code className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>{color}</code>
      </div>
    </div>
  );
}
