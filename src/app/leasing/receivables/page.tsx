import { redirect } from 'next/navigation';

export default function LeasingReceivablesRedirect() {
  redirect('/finance/ar-aging');
}
