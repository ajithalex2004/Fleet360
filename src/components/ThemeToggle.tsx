'use client';
/**
 * ThemeToggle — a compact Light / Dark / Auto segmented control for the top bar.
 */
import { useTheme, type ThemeChoice } from './ThemeProvider';

const OPTIONS: Array<{ key: ThemeChoice; label: string; mark: string }> = [
  { key: 'light', label: 'Light', mark: 'L' },
  { key: 'dark', label: 'Dark', mark: 'D' },
  { key: 'auto', label: 'Auto', mark: 'A' },
];

export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="inline-flex items-center rounded-xl border border-white/10 dark:border-white/10 border-slate-200/90 bg-slate-900/60 dark:bg-slate-900/60 bg-slate-100 p-1 shadow-inner" role="group" aria-label="Theme">
      {OPTIONS.map(({ key, label, mark }) => {
        const active = choice === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setChoice(key)}
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              active
                ? 'bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 text-white shadow-md shadow-cyan-500/25 scale-[1.02]'
                : 'text-slate-400 dark:text-slate-400 text-slate-600 hover:text-white dark:hover:text-white hover:text-slate-950'
            }`}
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] font-black leading-none">
              {mark}
            </span>
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
