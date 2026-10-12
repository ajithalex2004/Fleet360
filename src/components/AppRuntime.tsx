'use client';

import ToastProvider from '@/components/providers/ToastProvider';
import ClientProviders from '@/components/ClientProviders';
import GlobalDeferredWidgets from '@/components/GlobalDeferredWidgets';
import { ThemeProvider } from '@/components/ThemeProvider';
import CommandPalette from '@/components/navigation/CommandPalette';
import ChunkErrorReloader from '@/components/ChunkErrorReloader';

/**
 * The authenticated application runtime. Keeping it out of public marketing
 * routes avoids loading session, tenancy, command-palette, and deferred-widget
 * code before a prospective customer has chosen to enter the product.
 */
export default function AppRuntime({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChunkErrorReloader />
      <ThemeProvider>
        <ClientProviders>
          <ToastProvider>
            {children}
            <CommandPalette />
            <GlobalDeferredWidgets />
          </ToastProvider>
        </ClientProviders>
      </ThemeProvider>
    </>
  );
}
