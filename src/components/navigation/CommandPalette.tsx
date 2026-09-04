'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Search, 
  CarFront, 
  CalendarCheck, 
  Users, 
  FileText, 
  Compass, 
  Sparkles, 
  CornerDownLeft,
  X
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

interface SearchResultItem {
  id: string;
  type: 'module' | 'vehicle' | 'booking' | 'customer' | 'agreement' | 'action';
  title: string;
  subtitle: string;
  href?: string;
  action?: () => void;
  badge?: string;
}

const MODULE_PAGES: SearchResultItem[] = [
  { id: 'mod-fleet', type: 'module', title: 'Fleet Master', subtitle: 'Manage vehicle inventory, lifecycle & types', href: '/fleet/vehicles', badge: 'Fleet' },
  { id: 'mod-rental', type: 'module', title: 'Rent-A-Car Module', subtitle: 'Fleet RAC desk, bookings, permits & tariffs', href: '/rental/bookings', badge: 'RAC' },
  { id: 'mod-drivers', type: 'module', title: 'Driver Operations', subtitle: 'HOS, driver allocations, scoring & shifts', href: '/drivers', badge: 'Ops' },
  { id: 'mod-maint', type: 'module', title: 'Maintenance & Work Orders', subtitle: 'Workshop jobs, risk scoring & preventive alerts', href: '/maintenance', badge: 'Service' },
  { id: 'mod-analytics', type: 'module', title: 'Fleet Intelligence & Analytics', subtitle: 'TCO, carbon footprint, utilization & KPI reports', href: '/fleet/intelligence', badge: 'Analytics' },
  { id: 'mod-agents', type: 'module', title: 'AI Operations Command (Agents)', subtitle: 'Autonomous RAC, maintenance & compliance copilots', href: '/agents', badge: 'AI Copilot' },
  { id: 'mod-fines', type: 'module', title: 'Traffic Fines & Tolls (Salik / Darb)', subtitle: 'Automated toll & fine reconciliation with customer billing', href: '/fleet/fines', badge: 'Billing' },
  { id: 'mod-docs', type: 'module', title: 'Document Expiry & Compliance', subtitle: 'Mulkiya, insurance and commercial permit tracker', href: '/fleet/documents', badge: 'Compliance' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global toggle listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };

    const handleCustomOpen = () => setOpen(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('fleet360:open-command-palette', handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('fleet360:open-command-palette', handleCustomOpen);
    };
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search execution
  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (!trimmed) {
      // Show default quick actions & modules
      const defaultItems: SearchResultItem[] = [
        ...MODULE_PAGES,
        {
          id: 'action-theme',
          type: 'action',
          title: `Switch Theme (Currently ${theme})`,
          subtitle: 'Toggle between Aura Obsidian (Dark) and Crisp Light Mode',
          badge: 'Appearance',
          action: () => {
            setTheme(theme === 'dark' ? 'light' : 'dark');
            setOpen(false);
          },
        },
      ];
      setResults(defaultItems);
      setSelectedIndex(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    const fetchResults = async () => {
      try {
        // Filter static modules
        const matchedModules = MODULE_PAGES.filter(m => 
          m.title.toLowerCase().includes(trimmed.toLowerCase()) || 
          m.subtitle.toLowerCase().includes(trimmed.toLowerCase()) ||
          m.badge?.toLowerCase().includes(trimmed.toLowerCase())
        );

        // Fetch backend omni search
        const res = await fetch(`/api/search/omni?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal
        });
        
        let apiItems: SearchResultItem[] = [];
        if (res.ok) {
          const data = await res.json();
          apiItems = (data.results || []).map((r: any) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            subtitle: r.subtitle,
            href: r.href,
            badge: r.badge,
          }));
        }

        setResults([...matchedModules, ...apiItems]);
        setSelectedIndex(0);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchResults, 120);
    return () => {
      clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [query, open, theme, setTheme]);

  // Execute selection
  const handleSelect = useCallback((item: SearchResultItem) => {
    if (item.action) {
      item.action();
    } else if (item.href) {
      router.push(item.href);
      setOpen(false);
    }
  }, [router]);

  // Arrow key navigation
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1 < results.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!open) return null;

  const getItemIcon = (type: SearchResultItem['type']) => {
    switch (type) {
      case 'vehicle': return <CarFront className="w-4 h-4 text-amber-500" />;
      case 'booking': return <CalendarCheck className="w-4 h-4 text-emerald-500" />;
      case 'customer': return <Users className="w-4 h-4 text-blue-500" />;
      case 'agreement': return <FileText className="w-4 h-4 text-indigo-500" />;
      case 'action': return <Sparkles className="w-4 h-4 text-violet-500" />;
      case 'module': default: return <Compass className="w-4 h-4 text-sky-500" />;
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm transition-all"
      onClick={() => setOpen(false)}
    >
      <div 
        className="w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/30 gap-3">
          <Search className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search vehicles, bookings, customers, agreements, modules or actions..."
            className="flex-1 bg-transparent text-[var(--text-main)] text-sm placeholder-[var(--text-muted)] focus:outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <button 
            onClick={() => setOpen(false)}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div 
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 space-y-1 divide-y-0"
        >
          {results.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)] text-sm">
              {loading ? 'Searching fleet registry...' : 'No matching results found across Fleet360'}
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id + idx}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-[var(--text-main)] shadow-sm' 
                      : 'hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${isSelected ? 'bg-emerald-500/20' : 'bg-[var(--bg-surface-hover)]'}`}>
                      {getItemIcon(item.type)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate flex items-center gap-2">
                        <span>{item.title}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.badge && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                        {item.badge}
                      </span>
                    )}
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[10px]">↑</kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[10px]">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[10px]">↵</kbd>
              Open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono font-semibold text-[10px]">ESC</kbd>
              Dismiss
            </span>
          </div>
          <div className="flex items-center gap-1 text-[var(--text-muted)] font-medium">
            <span>Fleet360 Omni Engine</span>
          </div>
        </div>
      </div>
    </div>
  );
}
