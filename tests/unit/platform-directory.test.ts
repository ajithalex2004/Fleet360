import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PINNED_LAUNCHERS,
  PLATFORM_DIRECTORY,
  PLATFORM_FILTER_CHIPS,
  filterPlatformModules,
  resolvePinnedLaunchers,
} from '@/app/platform/modules-directory';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    tLabel: (s: string) => s,
    isRTL: false,
  }),
}));

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    user: null,
    tenant: null,
    permissions: [],
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({
    choice: 'light',
    resolved: 'light',
    setChoice: vi.fn(),
  }),
}));

vi.mock('@/components/ThemeToggle', () => ({
  default: () => React.createElement('div', { 'data-testid': 'theme-toggle' }),
}));

vi.mock('@/app/platform/PlatformSessionSlot', () => ({
  default: () => React.createElement('div', { 'data-testid': 'session-slot' }),
}));

import PlatformPage from '@/app/platform/page';

describe('Platform Split Directory & Live Module Inspector', () => {
  it('defines all 24 unique modules across the 6 filter categories with real routes', () => {
    expect(PLATFORM_DIRECTORY).toHaveLength(24);
    const ids = new Set(PLATFORM_DIRECTORY.map((m) => m.id));
    expect(ids.size).toBe(24);

    const countsByCat = PLATFORM_DIRECTORY.reduce<Record<string, number>>((acc, m) => {
      acc[m.filterKey] = (acc[m.filterKey] ?? 0) + 1;
      return acc;
    }, {});

    expect(countsByCat).toEqual({
      ai: 2,
      transport: 6,
      core: 6,
      assets: 4,
      safety: 4,
      finance: 2,
    });

    for (const m of PLATFORM_DIRECTORY) {
      expect(m.href.startsWith('/')).toBe(true);
      expect(m.metrics.length).toBeGreaterThan(0);
      expect(m.tags.length).toBeGreaterThan(0);
      expect(m.actions.length).toBeGreaterThan(0);
      for (const a of m.actions) {
        expect(a.href.startsWith('/')).toBe(true);
        expect(a.href).not.toContain('#launch');
        expect(a.href).not.toContain('#secondary');
      }
    }
  });

  it('filters modules accurately by category and free-text query', () => {
    expect(filterPlatformModules(PLATFORM_DIRECTORY, 'all', '')).toHaveLength(24);
    expect(filterPlatformModules(PLATFORM_DIRECTORY, 'transport', '')).toHaveLength(6);

    const salikMatches = filterPlatformModules(PLATFORM_DIRECTORY, 'all', 'Salik');
    expect(salikMatches.length).toBeGreaterThanOrEqual(2);
    expect(salikMatches.some((m) => m.id === 'compliance')).toBe(true);
    expect(salikMatches.some((m) => m.id === 'finance')).toBe(true);

    const eTokenMatches = filterPlatformModules(PLATFORM_DIRECTORY, 'transport', 'e-Token');
    expect(eTokenMatches.map((m) => m.id)).toEqual(['drayage']);

    expect(filterPlatformModules(PLATFORM_DIRECTORY, 'all', 'nonexistentmodulexyz')).toHaveLength(0);
  });

  it('resolves the 3 default pinned launchers and falls back gracefully for restricted tenants', () => {
    const fullPins = resolvePinnedLaunchers(PLATFORM_DIRECTORY);
    expect(fullPins.map((p) => p.moduleId)).toEqual(PINNED_LAUNCHERS.map((p) => p.moduleId));

    const restricted = PLATFORM_DIRECTORY.filter((m) => ['fleet', 'finance', 'admin'].includes(m.id));
    const fallbackPins = resolvePinnedLaunchers(restricted);
    expect(fallbackPins).toHaveLength(3);
    expect(fallbackPins.map((p) => p.moduleId)).toEqual(['fleet', 'finance', 'admin']);
  });

  it('renders the Split Directory & Live Module Inspector markup cleanly', () => {
    const html = renderToStaticMarkup(React.createElement(PlatformPage));

    expect(html).toContain('Fleet360');
    expect(html).toContain('ENTERPRISE');
    expect(html).toContain('id="split-search"');
    expect(html).toContain('id="split-list"');
    expect(html).toContain('id="inspector-panel"');
    expect(html).toContain('href="/approvals"');
    expect(html).toContain('href="/admin"');

    // Pinned quick-launch trio
    expect(html).toContain('Dispatch Control');
    expect(html).toContain('Port Drayage');
    expect(html).toContain('AI Copilot');

    // All filter chips rendered with counts
    for (const chip of PLATFORM_FILTER_CHIPS) {
      expect(html).toContain(`data-filter="${chip.key}"`);
    }

    // Default inspector shows first module with real route CTA
    expect(html).toContain('AI Agent Ecosystem &amp; Copilot');
    expect(html).toContain('Open Agent Command');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('Quick Capabilities');
  });
});
