'use client';
import { useLanguage } from '@/contexts/LanguageContext';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="flex items-center rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] p-0.5 text-xs font-semibold">
      <button
        type="button"
        onClick={() => setLanguage('ar')}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
          language === 'ar'
            ? 'bg-cyan-500 text-white shadow-sm font-bold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
        }`}
        title="العربية (Arabic)"
      >
        <span>🇦🇪</span>
        <span>العربية</span>
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
          language === 'en'
            ? 'bg-cyan-500 text-white shadow-sm font-bold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
        }`}
        title="English"
      >
        <span>🌐</span>
        <span>English</span>
      </button>
    </div>
  );
}
