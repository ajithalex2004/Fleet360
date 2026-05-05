export default function FleetLoading() {
  return (
    <div className="flex flex-col h-screen bg-slate-900 animate-pulse">
      {/* top bar skeleton */}
      <div className="h-10 bg-slate-950/90 border-b border-white/5 flex items-center px-4 gap-3 flex-shrink-0">
        <div className="h-6 w-28 rounded-lg bg-white/5" />
        <div className="flex-1" />
        <div className="h-6 w-20 rounded-full bg-white/5" />
        <div className="h-6 w-24 rounded-full bg-white/5" />
        <div className="h-6 w-24 rounded-full bg-white/5" />
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* sidebar skeleton */}
        <div className="w-56 bg-slate-900 border-r border-white/5 flex flex-col gap-2 p-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-white/5" />
          ))}
        </div>
        {/* content skeleton */}
        <div className="flex-1 p-6 flex flex-col gap-4">
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-white/5" />
            ))}
          </div>
          {/* table placeholder */}
          <div className="flex-1 rounded-xl bg-white/5" />
        </div>
      </div>
    </div>
  );
}
