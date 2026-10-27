import SystemHealthDashboardView from '@/components/admin/system-health-dashboard';

export default function JobRunsPage() {
  return <SystemHealthDashboardView isPublic={false} initialTab="job-runs" />;
}
