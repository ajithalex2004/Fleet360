'use client';

import React, { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';

export interface DrawerTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface DrawerAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SlideOverDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: {
    text: string;
    variant?: 'emerald' | 'amber' | 'blue' | 'slate' | 'rose' | 'violet';
  };
  tabs?: DrawerTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  children: React.ReactNode;
  actions?: DrawerAction[];
  width?: 'md' | 'lg' | 'xl' | '2xl';
}

const BADGE_STYLES: Record<string, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  slate: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
};

const WIDTH_CLASSES: Record<string, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export default function SlideOverDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  tabs = [],
  activeTab,
  onTabChange,
  children,
  actions = [],
  width = 'xl',
}: SlideOverDrawerProps) {
  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          className={`w-screen ${WIDTH_CLASSES[width] || 'max-w-xl'} bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col transform transition-transform duration-200 ease-out`}
        >
          {/* Header */}
          <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-[var(--text-main)] tracking-tight truncate">
                    {title}
                  </h2>
                  {badge && (
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
                        BADGE_STYLES[badge.variant || 'emerald'] || BADGE_STYLES.emerald
                      }`}
                    >
                      {badge.text}
                    </span>
                  )}
                </div>
                {subtitle && (
                  <p className="text-xs text-[var(--text-muted)] font-mono truncate">
                    {subtitle}
                  </p>
                )}
              </div>

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs Bar (if tabs provided) */}
            {tabs.length > 0 && (
              <div className="flex gap-1 mt-5 border-b border-[var(--border-subtle)] -mb-6 overflow-x-auto">
                {tabs.map((tab) => {
                  const isActive = (activeTab || tabs[0]?.id) === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => onTabChange?.(tab.id)}
                      className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                        isActive
                          ? 'border-emerald-500 text-emerald-500 font-bold'
                          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Drawer Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-[var(--text-main)]">
            {children}
          </div>

          {/* Drawer Footer Actions */}
          {actions.length > 0 && (
            <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-end gap-3 flex-shrink-0">
              {actions.map((action, idx) => {
                let btnStyle =
                  'bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] hover:border-[var(--border-strong)]';
                if (action.variant === 'primary') {
                  btnStyle =
                    'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:opacity-90 shadow-sm';
                } else if (action.variant === 'danger') {
                  btnStyle =
                    'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30';
                }
                return (
                  <button
                    key={idx}
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-50 ${btnStyle}`}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
