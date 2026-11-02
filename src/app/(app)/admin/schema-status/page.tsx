import SystemHealthDashboardView from '@/components/admin/system-health-dashboard';

export default function SchemaStatusPage() {
  return <SystemHealthDashboardView isPublic={false} initialTab="schema-status" />;
}
