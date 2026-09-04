'use client';
/**
 * ThemeToggle — sleek Linear/Vercel style segmented theme control.
 *
 * Two named themes: "Refined Dark" (the app's authored baseline) and
 * "Light Enterprise" (the html.light skin in globals.css). Buttons show
 * a short label so the control fits in the sidebar's fixed width; the
 * full theme name is in the tooltip/aria-label.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeChoice } from './ThemeProvider';

const OPTIONS: Array<{ key: Exclude<ThemeChoice, 'auto'>; label: string; fullLabel: string; icon: typeof Sun }> = [
  { key: 'dark', label: 'Dark', fullLabel: 'Refined Dark', icon: Moon },
  { key: 'light', label: 'Light', fullLabel: 'Light Enterprise', icon: Sun },
];

export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="inline-flex w-full items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ key, label, fullLabel, icon: Icon }) => {
        const active = choice === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setChoice(key)}
            title={fullLabel}
            aria-label={fullLabel}
            aria-pressed={active}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${
              active
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--text-main)] shadow-sm border border-[var(--border-subtle)] font-semibold'
                : 'text-[var(--text-faint)] hover:text-[var(--text-main)]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
