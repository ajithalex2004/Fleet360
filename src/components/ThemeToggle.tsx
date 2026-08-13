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
    <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Theme">
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
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] font-bold leading-none">
              {mark}
            </span>
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
