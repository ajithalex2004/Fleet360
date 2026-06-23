export default function ModuleLoadingSkeleton({ sidebarItems = 12 }: { sidebarItems?: number }) {
  return (
    <div className="flex h-screen flex-col bg-[color:var(--bg-primary)]">
      <div className="h-10 flex-shrink-0 border-b border-white/6 bg-slate-950/90 px-4">
        <div className="flex h-full items-center gap-3">
          <div className="fleet-skeleton h-6 w-28 rounded-lg" />
          <div className="flex-1" />
          <div className="fleet-skeleton h-6 w-16 rounded-full" />
          <div className="fleet-skeleton h-6 w-24 rounded-full" />
          <div className="fleet-skeleton h-6 w-20 rounded-full" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 flex-shrink-0 border-r border-white/6 bg-slate-900 p-3">
          <div className="fleet-skeleton mb-3 h-5 w-32 rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: sidebarItems }).map((_, i) => (
              <div key={i} className="fleet-skeleton h-8 rounded-xl" />
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-hidden p-6">
          <div className="flex items-end justify-between gap-4">
            <div className="space-y-3">
              <div className="fleet-skeleton h-9 w-64 rounded-2xl" />
              <div className="fleet-skeleton h-4 w-80 rounded-xl" />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <div className="fleet-skeleton h-10 w-24 rounded-2xl" />
              <div className="fleet-skeleton h-10 w-28 rounded-2xl" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="interactive-surface relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="fleet-skeleton h-3.5 w-24 rounded-lg" />
                <div className="fleet-skeleton mt-6 h-8 w-20 rounded-xl" />
                <div className="fleet-skeleton mt-3 h-3 w-28 rounded-lg" />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="fleet-skeleton h-11 w-40 rounded-2xl" />
            <div className="flex items-center gap-2">
              <div className="fleet-skeleton h-10 w-28 rounded-full" />
              <div className="fleet-skeleton h-10 w-28 rounded-full" />
              <div className="fleet-skeleton h-10 w-28 rounded-full" />
            </div>
          </div>

          <div className="interactive-surface relative min-h-0 flex-1 overflow-hidden rounded-[1.6rem] border border-white/8 bg-white/[0.03]">
            <div className="grid grid-cols-5 gap-0 border-b border-white/6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="border-r border-white/6 p-4 last:border-r-0">
                  <div className="fleet-skeleton h-4 w-24 rounded-lg" />
                  <div className="fleet-skeleton mt-4 h-11 w-full rounded-2xl" />
                </div>
              ))}
            </div>
            <div className="space-y-0 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="grid grid-cols-5 gap-0 border-b border-white/6 last:border-b-0">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <div key={j} className="border-r border-white/6 p-4 last:border-r-0">
                      <div className="fleet-skeleton h-5 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-slate-300">
            <div className="fleet-spinner h-5 w-5" />
            <span>Loading workspace</span>
            <span className="fleet-loading-dots text-blue-300"><span /><span /><span /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
