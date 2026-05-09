'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

// ── Module-level cache for /api/auth/me — survives admin page-to-page navigation ──
// Re-used across all /admin/* layout mounts within the same browser session.
let _meCache: MeResponse | null = null;
let _meCacheTs = 0;
const ME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Nav item definitions ────────────────────────────────────────────────────────

interface NavItem {
  href:        string;
  label:       string;
  icon:        string;
  navKey?:     string;   // toggleable key — absent = always show in its role group
  superOnly?:  boolean;  // true = hidden from TENANT_ADMIN regardless of permissions
  tenantBase?: boolean;  // true = always shown to TENANT_ADMIN (no toggle needed)
}

const ALL_NAV: NavItem[] = [
  // ── Always visible to everyone ──────────────────────────────────────────────
  { href: '/admin',         label: 'Overview',       icon: '📊', tenantBase: true  },
  { href: '/admin/users',   label: 'Users',           icon: '👤', tenantBase: true  },
  { href: '/admin/roles',   label: 'Roles & Permissions', icon: '🔐', tenantBase: true },

  // ── Toggleable by Super Admin for Tenant Admins ─────────────────────────────
  { href: '/admin/branches',  label: 'Branches & Regions',     icon: '🏢', navKey: 'branches'   },
  { href: '/admin/billing',   label: 'Billing & Subscriptions', icon: '💳', navKey: 'billing'    },
  { href: '/admin/workflows', label: 'Workflow Management',     icon: '⚡', navKey: 'workflows'  },
  { href: '/admin/esign',     label: 'E-Signing Console',       icon: '✍️', navKey: 'esign'      },
  { href: '/admin/whatsapp',  label: 'WhatsApp Support',        icon: '💬', navKey: 'whatsapp'   },
  { href: '/admin/dispatch',  label: 'Dispatch Monitor',        icon: '🚦', navKey: 'dispatch'   },
  { href: '/admin/audit-logs',label: 'Audit Log',               icon: '📋', navKey: 'audit-logs' },

  // ── Super Admin only — never shown to Tenant Admins ─────────────────────────
  { href: '/admin/tenants',                label: 'Tenants',           icon: 'T',  superOnly: true },
  { href: '/admin/info',                   label: 'Platform Info',     icon: 'ℹ️', superOnly: true },
  { href: '/admin/settings/notifications', label: 'Notifications',     icon: '🔔', superOnly: true },
  { href: '/admin/settings/integrations',  label: 'Integrations & ERP',icon: '🔗', superOnly: true },
  { href: '/admin/settings',              label: 'Platform Settings',  icon: '⚙️', superOnly: true },
];

// ── Session context ─────────────────────────────────────────────────────────────

interface MeResponse {
  userId:         string;
  tenantId:       string;
  tenantName:     string;
  plan:           string;
  role:           string;
  isSuperAdmin:   boolean;
  navPermissions: Record<string, boolean>;
}

// ── Layout ─────────────────────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname      = usePathname();
  const { tLabel, t } = useLanguage();

  // Initialise from module-level cache so sidebar renders on first paint,
  // no waiting for the network when navigating between /admin/* pages.
  const cachedNow = _meCache && Date.now() - _meCacheTs < ME_CACHE_TTL ? _meCache : null;
  const [me, setMe]         = useState<MeResponse | null>(cachedNow);
  const [loading, setLoading] = useState(!cachedNow);

  useEffect(() => {
    // Skip network if cache is still fresh
    if (_meCache && Date.now() - _meCacheTs < ME_CACHE_TTL) {
      setMe(_meCache);
      setLoading(false);
      return;
    }
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) { _meCache = data; _meCacheTs = Date.now(); }
        setMe(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Build the filtered nav based on role + permissions ─────────────────────
  const visibleNav = (() => {
    if (!me) return [];

    if (me.isSuperAdmin) return ALL_NAV; // Super Admin sees everything

    // Tenant Admin — base items + platform-admin-enabled optional items
    return ALL_NAV.filter(item => {
      if (item.superOnly)  return false;                       // always hidden
      if (item.tenantBase) return true;                        // always visible
      return me.navPermissions[item.navKey ?? ''] === true;   // enabled by Super Admin
    });
  })();

  const isTrial      = me?.plan === 'TRIAL';
  const isSuperAdmin = me?.isSuperAdmin ?? false;

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
      <PlatformHomeBar moduleName={t('module.admin')} moduleIcon="A" accentColor="from-red-500 to-rose-600" />

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 flex-shrink-0 border-r border-white/10 bg-slate-950 overflow-y-auto">

          {/* Identity block */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white font-bold text-sm">A</div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{t('module.admin')}</p>
                <p className="text-slate-400 text-xs truncate">
                  {loading ? '…' : (me?.tenantName || 'Fleet360')}
                </p>
              </div>
            </div>

            {/* Role badge */}
            {!loading && me && (
              <div className="mt-3 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                  isSuperAdmin
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                }`}>
                  {isSuperAdmin ? '⚡ Super Admin' : '🏢 Tenant Admin'}
                </span>
                {isTrial && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Trial
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="p-3 space-y-1">
            {loading ? (
              <div className="space-y-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 rounded-xl bg-slate-800/50 animate-pulse" />
                ))}
              </div>
            ) : (
              visibleNav.map(item => {
                const active = item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                      active
                        ? 'bg-red-500/20 text-white border border-red-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      active ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {item.icon}
                    </span>
                    {tLabel(item.label)}
                  </Link>
                );
              })
            )}
          </nav>

          {/* Footer badges */}
          <div className="p-3 space-y-2">
            {isSuperAdmin && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-red-400 text-xs font-semibold mb-0.5">SUPER ADMIN ZONE</p>
                <p className="text-slate-400 text-xs">Changes here affect all tenants platform-wide.</p>
              </div>
            )}
            {!isSuperAdmin && !loading && (
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <p className="text-blue-400 text-xs font-semibold mb-0.5">TENANT ADMIN</p>
                <p className="text-slate-400 text-xs">Managing your organisation only.</p>
              </div>
            )}
            {isTrial && !loading && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-amber-400 text-xs font-semibold mb-0.5">⚠️ FREE TRIAL</p>
                <p className="text-slate-400 text-xs">Most modules are read-only. Upgrade to unlock full access.</p>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-950 relative">
          {/* Trial read-only banner */}
          {isTrial && !loading && (
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center gap-2">
              <span className="text-amber-400 text-xs font-semibold">READ-ONLY MODE</span>
              <span className="text-slate-400 text-xs">Free Trial — Fleet Management has full access. All other modules are view-only.</span>
              <a href="/admin/billing" className="ml-auto text-xs text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap">Upgrade Plan →</a>
            </div>
          )}
          <div className="p-8 min-h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
