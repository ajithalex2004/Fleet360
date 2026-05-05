'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV = [
  { href: '/sustainability',                label: 'ESG Dashboard',        icon: '🌍' },
  { href: '/sustainability/reports',        label: 'Emission Reports',      icon: '📊' },
  { href: '/sustainability/fleet-carbon',   label: 'Fleet Carbon',         icon: '🚗' },
  { href: '/sustainability/modal-shift',    label: 'Modal Shift',          icon: '🔄' },
  { href: '/sustainability/paperless',      label: 'Paperless Ops',        icon: '📄' },
  { href: '/sustainability/certifications', label: 'Certifications',       icon: '🏆' },
  { href: '/sustainability/settings',       label: 'Methodology Settings', icon: '⚙️' },
];

export default function SustainabilityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();
  const isActive = (href: string) =>
    href === '/sustainability' ? pathname === '/sustainability' : pathname.startsWith(href);

  return (
    <ModuleGuard moduleId="sustainability" moduleName="Sustainability & ESG" moduleIcon="🌱">
    <div className="flex flex-col h-screen bg-slate-950">
      <PlatformHomeBar moduleName={t('module.sustainability')} moduleIcon="🌱" accentColor="from-emerald-500 to-green-600" />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 bg-gradient-to-b from-emerald-950/80 to-slate-950 border-r border-emerald-900/30 overflow-y-auto">
          <div className="p-4 border-b border-emerald-900/30">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-lg shadow-lg shadow-emerald-900/40">
                🌱
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t('module.sustainability')}</p>
                <p className="text-emerald-400/70 text-xs">ESG · GHG Protocol · ISO 14064</p>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-0.5">
            {NAV.map(item => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                    active
                      ? 'bg-emerald-500/20 text-white border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}>
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${
                    active ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}>{item.icon}</span>
                  <span>{tLabel(item.label)}</span>
                </Link>
              );
            })}
          </nav>

          {/* UAE Net Zero badge */}
          <div className="mx-3 mt-4 p-3 rounded-xl bg-gradient-to-br from-emerald-900/40 to-green-900/20 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🇦🇪</span>
              <p className="text-emerald-400 text-xs font-bold uppercase tracking-wide">UAE Net Zero 2050</p>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Aligned with UAE Green Agenda 2030 &amp; COP28 commitments
            </p>
          </div>

          {/* Methodology badges */}
          <div className="mx-3 mt-3 mb-4 space-y-1.5">
            {[
              { label: 'GHG Protocol', sub: 'Project Standard' },
              { label: 'ISO 14064-1', sub: '2018 Edition' },
              { label: 'IPCC AR6', sub: 'Emission Factors' },
            ].map(b => (
              <div key={b.label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/60 border border-white/5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-white text-xs font-medium">{b.label}</p>
                  <p className="text-slate-500 text-xs">{b.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
