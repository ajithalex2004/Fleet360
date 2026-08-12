import { redirect } from 'next/navigation';

export default function LeasingReceiptsRedirect() {
  redirect('/finance/payments');
}
