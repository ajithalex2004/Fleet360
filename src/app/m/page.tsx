'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { UniversalMobileBookingApp } from '@/components/mobile/UniversalMobileBookingApp';

export default function MobileAppPage() {
  return (
    <div className="min-h-screen bg-slate-950">
      <UniversalMobileBookingApp />
    </div>
  );
}
