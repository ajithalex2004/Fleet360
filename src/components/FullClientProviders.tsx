'use client';

import { PermissionProvider } from '@/contexts/PermissionContext';
import { BranchProvider } from '@/contexts/BranchContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

export default function FullClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <PermissionProvider>
        <BranchProvider>
          {children}
        </BranchProvider>
      </PermissionProvider>
    </LanguageProvider>
  );
}
