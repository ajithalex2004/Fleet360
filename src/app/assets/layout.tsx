'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/assets', label: 'Dashboard', icon: '🏠' },
    ],
  },
  {
    label: 'Asset Registry',
    items: [
      { href: '/assets/registry', label: 'Asset Catalog', icon: '📦' },
      { href: '/assets/categories', label: 'Categories', icon: '🏷️' },
      { href: '/assets/hva', label: 'High Value Assets', icon: '💎' },
      { href: '/assets/medical', label: 'Medical Assets', icon: '🏥' },
    ],
  },
  {
    label: 'BLE Tracking',
    items: [
      { href: '/assets/ble-tags', label: 'BLE Tags', icon: '📡' },
      { href: '/assets/ble-gateways', label: 'BLE Gateways', icon: '📶' },
      { href: '/assets/map', label: 'Asset Map', icon: '🗺️' },
    ],
  },
  {
    label: 'BLE Hardware',
    items: [
      { href: '/assets/ble-detections', label: 'Detection Log', icon: '📡' },
      { href: '/assets/ble-alerts', label: 'Movement Alerts', icon: '🚨' },
      { href: '/assets/ble-zones', label: 'Zone Rules', icon: '🗺️' },
    ],
  },
  {
    label: 'Stock Operations',
    items: [
      { href: '/assets/stock', label: 'Stock Levels', icon: '📊' },
      { href: '/assets/transactions', label: 'Transaction Ledger', icon: '📋' },
      { href: '/assets/timeline', label: 'Asset Timeline', icon: '🕐' },
    ],
  },
  {
    label: 'Field Logistics',
    items: [
      { href: '/assets/dispatch', label: 'Field Dispatch', icon: '🚚' },
      { href: '/assets/personnel', label: 'Personnel Ledger', icon: '👷' },
      { href: '/assets/returns', label: 'Return Requests', icon: '↩️' },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { href: '/assets/spm', label: 'Preventive Maintenance', icon: '🔧' },
      { href: '/assets/spm/tickets', label: 'SPM Tickets', icon: '🎫' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href.split('/').length === 2) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ModuleGuard moduleId="assets" moduleName="Assets & Inventory" moduleIcon="🏗️">
    <div className="flex flex-col h-screen bg-slate-950">
      <PlatformHomeBar moduleName="Assets & Inventory" moduleIcon="🏗️" accentColor="from-yellow-400 to-amber-600" />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-60 border-r border-white/8 bg-slate-900 overflow-y-auto flex-shrink-0">
          <div className="p-4 border-b border-white/8 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center text-slate-950 font-bold text-sm">🏗️</div>
            <div>
              <p className="text-white font-semibold text-sm">Assets & Inventory</p>
              <p className="text-slate-400 text-xs">Unified Registry</p>
            </div>
          </div>
          <nav className="p-3 space-y-4">
            {NAV_SECTIONS.map(section => (
              <div key={section.label}>
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{section.label}</p>
                <div className="space-y-0.5">
                  {section.items.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive(pathname, item.href)
                          ? 'bg-yellow-300/10 text-yellow-300 border border-yellow-500/40'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-base leading-none">{item.icon}</span>
                      <span className="font-medium">{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
        <main className="flex-1 overflow-y-auto bg-slate-950">{children}</main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
