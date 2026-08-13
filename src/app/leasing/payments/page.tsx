import { redirect } from 'next/navigation';

export default function LeasingPaymentsRedirect() {
  redirect('/finance/payments');
}
