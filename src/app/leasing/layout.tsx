import React from 'react';
import LeasingShell from './leasing-shell';

export default function LeasingLayout({ children }: { children: React.ReactNode }) {
  return <LeasingShell>{children}</LeasingShell>;
}
