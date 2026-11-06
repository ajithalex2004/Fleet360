import { redirect } from 'next/navigation';

export default function SchemaStatusPage() {
  redirect('/admin/health?tab=schema-status');
}
