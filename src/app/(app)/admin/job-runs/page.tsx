import { redirect } from 'next/navigation';

export default function JobRunsPage() {
  redirect('/admin/health?tab=job-runs');
}
