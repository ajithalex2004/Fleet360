/**
 * Reusable module loading skeleton — used by all module loading.tsx files.
 * Renders an animated placeholder that matches the standard sidebar + content layout.
 */
export default function ModuleLoadingSkeleton({ sidebarItems = 12 }: { sidebarItems?: number }) {
  return (
    <div className="flex flex-col h-screen bg-slate-900 animate-pulse">
      {/* PlatformHomeBar skeleton */}
      <div className="h-10 bg-slate-950/90 border-b border-white/5 flex items-center px-4 gap-3 flex-shrink-0">
        <div className="h-6 w-28 rounded-lg bg-white/5" />
        <div className="flex-1" />
        <div className="h-6 w-16 rounded-full bg-white/5" />
        <div className="h-6 w-24 rounded-full bg-white/5" />
        <div className="h-6 w-20 rounded-full bg-white/5" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="w-56 bg-slate-900 border-r border-white/5 flex flex-col gap-2 p-3 flex-shrink-0">
          <div className="h-5 w-32 rounded bg-white/5 mb-2" />
          {Array.from({ length: sidebarItems }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-white/5" />
          ))}
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
          {/* Page title */}
          <div className="h-8 w-64 rounded bg-white/5" />

          {/* KPI strip — 4 tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-white/5" />
            ))}
          </div>

          {/* Filter bar */}
          <div className="h-10 rounded-lg bg-white/5" />

          {/* Main table / content area */}
          <div className="flex-1 rounded-xl bg-white/5 min-h-0" />
        </div>
      </div>
    </div>
  );
}
