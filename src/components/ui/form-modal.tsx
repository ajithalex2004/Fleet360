'use client';

/**
 * FormModal — the form kit's dialog shell.
 *
 * Most create/edit forms open in a dialog. This puts the same FormPanel card
 * (icon header, title, subtitle) the Drayage Create Jobs page uses on a dimmed
 * overlay, with a close button in the header. Put FormSection / FormField /
 * FormFooter from `form-kit` inside it, usually wrapped in your <form>.
 *
 *   <FormModal open={show} onClose={() => setShow(false)} title="Record fine" icon={AlertTriangle}>
 *     <form onSubmit={save} className="space-y-5">
 *       <FormSection title="Fine details">…</FormSection>
 *       <FormFooter secondary={<SecondaryButton onClick={close}>Cancel</SecondaryButton>}>
 *         <PrimaryButton type="submit">Save</PrimaryButton>
 *       </FormFooter>
 *     </form>
 *   </FormModal>
 */

import React, { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { FormPanel } from '@/components/ui/form-kit';

type Accent = React.ComponentProps<typeof FormPanel>['accent'];

const WIDTHS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
} as const;

export function FormModal({
  open = true, onClose, title, subtitle, icon, accent = 'blue', size = 'md', actions, children, zIndex = 'z-50',
}: {
  open?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: Accent;
  size?: keyof typeof WIDTHS;
  /** Extra header controls, shown left of the close button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  zIndex?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:py-10`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`w-full ${WIDTHS[size]} shadow-2xl rounded-xl`}>
        <FormPanel
          title={title}
          subtitle={subtitle}
          icon={icon}
          accent={accent}
          actions={(
            <>
              {actions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-main)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        >
          {children}
        </FormPanel>
      </div>
    </div>
  );
}
