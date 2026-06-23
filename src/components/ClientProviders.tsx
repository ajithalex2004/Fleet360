'use client';
import { PermissionProvider } from '@/contexts/PermissionContext';
import { BranchProvider } from '@/contexts/BranchContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <PermissionProvider>
          <BranchProvider>
            {children}
          </BranchProvider>
        </PermissionProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
