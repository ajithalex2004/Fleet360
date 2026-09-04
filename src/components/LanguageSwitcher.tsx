'use client';
import { useLanguage } from '@/contexts/LanguageContext';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <button
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-elevated)] transition-colors text-xs font-medium text-[var(--text-main)] border border-[var(--border-subtle)]"
      title={language === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
    >
      <span className="text-sm">{language === 'en' ? '🇦🇪' : '🇬🇧'}</span>
      <span>{language === 'en' ? 'العربية' : 'English'}</span>
    </button>
  );
}
