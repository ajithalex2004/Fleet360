import SystemHealthDashboardView from '@/components/admin/system-health-dashboard';

export default function PublicHealthPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] py-8">
      <SystemHealthDashboardView isPublic={true} />
    </div>
  );
}
