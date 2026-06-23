'use client';

import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ui/ThemeToggle';

const SHELL_ROUTES = [
  '/admin',
  '/agents',
  '/approvals',
  '/assets',
  '/booking-portal',
  '/bus-ops',
  '/compliance',
  '/customer',
  '/customer-mgmt',
  '/dispatch',
  '/driver-mgmt',
  '/finance',
  '/fleet',
  '/incidents',
  '/leasing',
  '/logistics',
  '/maintenance',
  '/platform',
  '/rental',
  '/reports',
  '/school-bus',
  '/sustainability',
];

export default function ThemeFloatingToggle() {
  const pathname = usePathname();
  const usesShellToggle = SHELL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (usesShellToggle) return null;

  return (
    <div className="fixed right-4 top-4 z-[80]">
      <ThemeToggle />
    </div>
  );
}
