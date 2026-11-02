import SystemHealthDashboardView from '@/components/admin/system-health-dashboard';

export default function AdminInfoPage() {
  return <SystemHealthDashboardView isPublic={false} initialTab="platform-info" />;
}
