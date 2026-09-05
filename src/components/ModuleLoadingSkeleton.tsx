/**
 * Reusable module loading skeleton — used by all module loading.tsx files.
 * Renders an animated placeholder that matches the standard sidebar + content layout.
 */
export default function ModuleLoadingSkeleton({ sidebarItems = 12 }: { sidebarItems?: number }) {
  return (
    <div className="flex flex-col h-screen bg-[var(--bg-canvas)] animate-pulse">
      {/* PlatformHomeBar skeleton */}
      <div className="h-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex items-center px-4 gap-3 flex-shrink-0">
        <div className="h-6 w-28 rounded-lg bg-[var(--bg-surface-hover)]" />
        <div className="flex-1" />
        <div className="h-6 w-16 rounded-full bg-[var(--bg-surface-hover)]" />
        <div className="h-6 w-24 rounded-full bg-[var(--bg-surface-hover)]" />
        <div className="h-6 w-20 rounded-full bg-[var(--bg-surface-hover)]" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col gap-2 p-3 flex-shrink-0">
          <div className="h-5 w-32 rounded bg-[var(--bg-surface-hover)] mb-2" />
          {Array.from({ length: sidebarItems }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-[var(--bg-surface-hover)]" />
          ))}
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
          {/* Page title */}
          <div className="h-8 w-64 rounded bg-[var(--bg-surface-hover)]" />

          {/* KPI strip — 4 tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-[var(--bg-surface-hover)]" />
            ))}
          </div>

          {/* Filter bar */}
          <div className="h-10 rounded-lg bg-[var(--bg-surface-hover)]" />

          {/* Main table / content area */}
          <div className="flex-1 rounded-xl bg-[var(--bg-surface-hover)] min-h-0" />
        </div>
      </div>
    </div>
  );
}
