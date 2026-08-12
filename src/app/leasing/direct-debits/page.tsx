import { redirect } from 'next/navigation';

export default function LeasingDirectDebitsRedirect() {
  redirect('/finance/payments');
}
