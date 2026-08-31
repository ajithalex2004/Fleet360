import React from 'react';
import BookingPortalShell from './booking-portal-shell';

export default function BookingPortalLayout({ children }: { children: React.ReactNode }) {
  return <BookingPortalShell>{children}</BookingPortalShell>;
}
