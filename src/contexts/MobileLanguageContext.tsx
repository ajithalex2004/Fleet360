'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

import arCommon from '../lib/i18n/ar/common.json';
import enCommon from '../lib/i18n/en/common.json';
import hiCommon from '../lib/i18n/hi/common.json';
import arDriver from '../lib/i18n/ar/driver.json';
import enDriver from '../lib/i18n/en/driver.json';
import hiDriver from '../lib/i18n/hi/driver.json';
import arPassenger from '../lib/i18n/ar/passenger.json';
import enPassenger from '../lib/i18n/en/passenger.json';
import hiPassenger from '../lib/i18n/hi/passenger.json';
import arBooking from '../lib/i18n/ar/booking.json';
import enBooking from '../lib/i18n/en/booking.json';
import hiBooking from '../lib/i18n/hi/booking.json';

export type MobileLanguage = 'en' | 'ar' | 'hi';
export type I18nDomain = 'common' | 'driver' | 'passenger' | 'booking';

const DICTIONARIES: Record<MobileLanguage, Record<I18nDomain, Record<string, string>>> = {
  ar: {
    common: arCommon,
    driver: arDriver,
    passenger: arPassenger,
    booking: arBooking,
  },
  en: {
    common: enCommon,
    driver: enDriver,
    passenger: enPassenger,
    booking: enBooking,
  },
  hi: {
    common: hiCommon,
    driver: hiDriver,
    passenger: hiPassenger,
    booking: hiBooking,
  },
};

interface MobileLanguageContextValue {
  language: MobileLanguage;
  isRTL: boolean;
  setLanguage: (lang: MobileLanguage) => void;
  toggleLanguage: () => void;
  t: (key: string, domain?: I18nDomain) => string;
}

const MobileLanguageContext = createContext<MobileLanguageContextValue>({
  language: 'en',
  isRTL: false,
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key: string) => key,
});

export function MobileLanguageProvider({
  children,
  defaultLanguage = 'en',
}: {
  children: ReactNode;
  defaultLanguage?: MobileLanguage;
}) {
  const [language, setLanguageState] = useState<MobileLanguage>(defaultLanguage);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fleet360_mobile_lang') as MobileLanguage | null;
      if (saved === 'ar' || saved === 'en' || saved === 'hi') {
        setLanguageState(saved);
      } else {
        setLanguageState('en');
      }
    } catch {
      setLanguageState('en');
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = language;
      localStorage.setItem('fleet360_mobile_lang', language);
    } catch {}
  }, [language]);

  const setLanguage = useCallback((lang: MobileLanguage) => {
    setLanguageState(lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState(prev => (prev === 'en' ? 'ar' : prev === 'ar' ? 'hi' : 'en'));
  }, []);

  const t = useCallback(
    (key: string, domain: I18nDomain = 'common'): string => {
      const dict = DICTIONARIES[language]?.[domain] || {};
      if (dict[key]) return dict[key];
      // Fallback to english if missing in arabic
      const enDict = DICTIONARIES.en?.[domain] || {};
      if (enDict[key]) return enDict[key];
      // Fallback to common
      const commonDict = DICTIONARIES[language]?.common || {};
      if (commonDict[key]) return commonDict[key];
      return key;
    },
    [language],
  );

  return (
    <MobileLanguageContext.Provider
      value={{
        language,
        isRTL: language === 'ar',
        setLanguage,
        toggleLanguage,
        t,
      }}
    >
      {children}
    </MobileLanguageContext.Provider>
  );
}

export function useMobileI18n() {
  return useContext(MobileLanguageContext);
}
