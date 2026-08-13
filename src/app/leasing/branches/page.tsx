import { redirect } from 'next/navigation';

export default function LeasingBranchesRedirectPage() {
  redirect('/admin/branches');
}
