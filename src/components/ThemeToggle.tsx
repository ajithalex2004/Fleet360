'use client';
/**
 * ThemeToggle — sleek Linear/Vercel style segmented theme control.
 */
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeChoice } from './ThemeProvider';

const OPTIONS: Array<{ key: ThemeChoice; label: string; icon: typeof Sun }> = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'auto', label: 'System', icon: Monitor },
];

export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="inline-flex items-center rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const active = choice === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setChoice(key)}
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${
              active
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm border border-black/5 dark:border-white/10 font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
