'use client';

/**
 * Module header: breadcrumb plus a strip of tabs for the module's pages.
 *
 * The same header Port Drayage uses, shared so every module navigates the
 * same way. Put it in a module's layout.tsx and render the page below it:
 *
 *   <ModuleSubNav parent={{ label: 'Live Operations' }} title="Booking Portal" tabs={TABS} />
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface ModuleTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (use for the module's landing page). */
  exact?: boolean;
}

export function ModuleSubNav({
  parent, title, tabs,
}: {
  parent?: { label: string; href?: string };
  title: string;
  tabs: ModuleTab[];
}) {
  const pathname = usePathname() ?? '';
  const { tLabel } = useLanguage();
  const isActive = (tab: ModuleTab) => (tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`));

  return (
    <div className="border-b border-[var(--border-subtle)] pb-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2 font-medium">
        {parent && (
          <>
            {parent.href ? (
              <Link href={parent.href} className="hover:text-[var(--text-main)] transition-colors">{tLabel(parent.label)}</Link>
            ) : (
              <span>{tLabel(parent.label)}</span>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] rtl:rotate-180" />
          </>
        )}
        <span className="text-[var(--text-main)] font-semibold">{tLabel(title)}</span>
      </div>

      <nav aria-label={`${title} pages`} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                active
                  ? 'bg-blue-600/15 border-blue-500/40 text-blue-400 font-bold shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-blue-400' : 'text-[var(--text-muted)]'}`} />
              <span>{tLabel(tab.label)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
