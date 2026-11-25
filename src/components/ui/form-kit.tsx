'use client';

/**
 * Fleet360 form kit — the one form style for every module.
 *
 * Modelled on Port Drayage › Create Jobs: a Panel card with an icon header,
 * inset sections with small uppercase headings, compact semibold labels with
 * an optional muted qualifier and helper text, flat theme-aware inputs with a
 * blue focus border, and a footer with a secondary action on the left and the
 * blue primary action on the right. Everything uses the theme variables
 * (--bg-main, --bg-surface, --border-subtle, --text-main, --text-muted), so a
 * form looks right in both Light and Dark without per-page overrides.
 *
 *   <FormPanel title="New Service Request" subtitle="…" icon={Wrench}>
 *     <FormSection title="Service classification" icon={ListTree} columns={2}>
 *       <FormField label="Service category" required>
 *         <SelectInput …>…</SelectInput>
 *       </FormField>
 *     </FormSection>
 *     <FormFooter secondary={<SecondaryButton …/>}>
 *       <PrimaryButton type="submit" icon={Send}>Submit request</PrimaryButton>
 *     </FormFooter>
 *   </FormPanel>
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';

type Accent = React.ComponentProps<typeof Panel>['accent'];

/** Shared input look — use on any <input>, <select> or <textarea>. */
export const formInputCls =
  'w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-medium '
  + 'text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none focus:border-blue-500 '
  + 'disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const COLS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

/** The form card: icon + title + subtitle header, padded body. */
export function FormPanel({
  title, subtitle, icon, accent = 'blue', actions, children, className = '',
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: Accent;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel title={title} subtitle={subtitle} icon={icon} accent={accent} actions={actions} className={`overflow-visible ${className}`}>
      <div className="space-y-5 text-xs">{children}</div>
    </Panel>
  );
}

/** An inset group of fields with a small uppercase heading. */
export function FormSection({
  title, icon: Icon, columns = 2, aside, children,
}: {
  title: string;
  icon?: LucideIcon;
  columns?: 1 | 2 | 3 | 4;
  /** Right-aligned extra content in the heading row (a badge, a link). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--bg-main)]/60 rounded-xl p-4 border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
          {Icon && <Icon className="w-3.5 h-3.5 text-blue-400" />}
          <span>{title}</span>
        </h4>
        {aside}
      </div>
      <div className={`grid ${COLS[columns]} gap-4`}>{children}</div>
    </section>
  );
}

/** Label + control + helper text. `span` widens the field across the section grid. */
export function FormField({
  label, qualifier, hint, required, htmlFor, span, children, className = '',
}: {
  label: string;
  /** Muted text after the label, e.g. "(Consignor/Shipper)". */
  qualifier?: string;
  hint?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  span?: 'full' | 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  const spanCls = span === 'full' ? 'md:col-span-full' : span === 2 ? 'md:col-span-2' : span === 3 ? 'md:col-span-3' : '';
  return (
    <div className={`space-y-1.5 ${spanCls} ${className}`}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-[var(--text-main)]">
        {label}
        {qualifier && <span className="font-normal text-[var(--text-muted)]"> {qualifier}</span>}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', ...rest }, ref) {
    return <input ref={ref} {...rest} className={`${formInputCls} ${className}`} />;
  },
);

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectInput({ className = '', ...rest }, ref) {
    return <select ref={ref} {...rest} className={`${formInputCls} ${className}`} />;
  },
);

export const TextAreaInput = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextAreaInput({ className = '', rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} {...rest} className={`${formInputCls} ${className}`} />;
  },
);

/** Checkbox with its label on the right. */
export function CheckboxField({
  label, checked, onChange, hint, disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer" />
      <span>
        <span className="text-xs font-medium text-[var(--text-main)]">{label}</span>
        {hint && <span className="block text-[10px] text-[var(--text-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** A read-only value tile — for values set elsewhere (e.g. priority and SLA from a master). */
export function ReadOnlyValue({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'default' | 'rose' | 'amber' | 'blue' | 'emerald' }) {
  const toneCls = {
    default: 'text-[var(--text-main)]',
    rose: 'text-rose-500',
    amber: 'text-amber-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
  }[tone ?? 'default'];
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`text-sm font-bold ${toneCls}`}>{value}</div>
    </div>
  );
}

/** Inline form message. */
export function FormAlert({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'warning' | 'info' }) {
  const cls = {
    error: 'bg-rose-500/10 border-rose-500/30 text-rose-500',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-500',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${cls}`}>
      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
      <div>{children}</div>
    </div>
  );
}

/** Footer row: secondary action(s) on the left, primary on the right. */
export function FormFooter({ secondary, children }: { secondary?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">{secondary}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; busy?: boolean };

export function PrimaryButton({ icon: Icon, busy, children, className = '', type = 'button', disabled, ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || busy} {...rest}
      className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50 ${className}`}>
      {Icon && <Icon className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />}
      {children}
    </button>
  );
}

export function SecondaryButton({ icon: Icon, children, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors disabled:opacity-50 ${className}`}>
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}
