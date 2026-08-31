import React from 'react';
import IncidentsShell from './incidents-shell';

export default function IncidentsLayout({ children }: { children: React.ReactNode }) {
  return <IncidentsShell>{children}</IncidentsShell>;
}
