import { redirect } from 'next/navigation';

export default function AdminInfoPage() {
  redirect('/admin/health?tab=platform-info');
}
