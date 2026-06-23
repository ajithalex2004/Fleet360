'use client';

import { Laptop, Moon, SunMedium } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/components/providers/ThemeProvider';

const OPTIONS: { value: ThemeMode; label: string; icon: typeof SunMedium }[] = [
  { value: 'light', label: 'Light', icon: SunMedium },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Laptop },
];

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div
      className="interactive-surface flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-xl"
      aria-label="Theme toggle"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={active}
            title={`${option.label} mode`}
            className={`theme-toggle-chip fleet-focus-ring flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold transition-all sm:px-3 ${
              active
                ? 'bg-white text-slate-900 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.45)]'
                : 'text-slate-300 hover:-translate-y-[1px] hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? 'text-slate-900' : resolvedTheme === 'light' ? 'text-slate-600' : 'text-slate-300'}`} />
            <span className="hidden md:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
