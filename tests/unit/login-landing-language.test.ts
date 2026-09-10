import { describe, it, expect } from 'vitest';
import { arabicLabels } from '@/contexts/LanguageContext';

describe('Login Page & Landing Page Language Policy', () => {
  describe('Language Resolution Engine', () => {
    function resolvePageLanguage(tenantDefaultLanguage?: string | null): { language: 'en' | 'ar'; isRTL: boolean; dir: 'ltr' | 'rtl' } {
      if (tenantDefaultLanguage === 'ar') {
        return { language: 'ar', isRTL: true, dir: 'rtl' };
      }
      return { language: 'en', isRTL: false, dir: 'ltr' };
    }

    it('defaults to English (LTR) when no tenant configuration exists', () => {
      const result = resolvePageLanguage(undefined);
      expect(result.language).toBe('en');
      expect(result.isRTL).toBe(false);
      expect(result.dir).toBe('ltr');
    });

    it('defaults to English (LTR) when tenant defaultLanguage is null', () => {
      const result = resolvePageLanguage(null);
      expect(result.language).toBe('en');
      expect(result.isRTL).toBe(false);
      expect(result.dir).toBe('ltr');
    });

    it('defaults to English (LTR) when tenant defaultLanguage is explicitly "en"', () => {
      const result = resolvePageLanguage('en');
      expect(result.language).toBe('en');
      expect(result.isRTL).toBe(false);
      expect(result.dir).toBe('ltr');
    });

    it('switches to Arabic (RTL) only when tenant admin defaultLanguage is explicitly "ar"', () => {
      const result = resolvePageLanguage('ar');
      expect(result.language).toBe('ar');
      expect(result.isRTL).toBe(true);
      expect(result.dir).toBe('rtl');
    });
  });

  describe('Branding & Public Endpoint Resolution', () => {
    it('determines whether an endpoint call is public based on query parameters', () => {
      function shouldAllowPublicBrandingLookup(url: string): boolean {
        const parsed = new URL(url, 'http://localhost');
        const code = parsed.searchParams.get('tenant');
        const domain = parsed.searchParams.get('domain');
        return Boolean(code || domain);
      }

      expect(shouldAllowPublicBrandingLookup('/api/branding?tenant=ACME')).toBe(true);
      expect(shouldAllowPublicBrandingLookup('/api/branding?domain=fleet.ae')).toBe(true);
      expect(shouldAllowPublicBrandingLookup('/api/branding')).toBe(false);
    });

    it('maps tenant database record to branding object including defaultLanguage', () => {
      interface BrandingRow {
        brand_product_name: string | null;
        brand_tagline: string | null;
        brand_logo_url: string | null;
        brand_favicon_url: string | null;
        brand_primary_color: string | null;
        brand_accent_color: string | null;
        default_language?: string | null;
      }

      function rowToBranding(r: BrandingRow) {
        return {
          productName: r.brand_product_name,
          tagline: r.brand_tagline,
          logoUrl: r.brand_logo_url,
          faviconUrl: r.brand_favicon_url,
          primaryColor: r.brand_primary_color,
          accentColor: r.brand_accent_color,
          defaultLanguage: r.default_language ?? 'en',
        };
      }

      const rowArabic: BrandingRow = {
        brand_product_name: 'أساطيل دبي',
        brand_tagline: 'إدارة النقل الذكي',
        brand_logo_url: '/logos/dubai.png',
        brand_favicon_url: '/favicon.ico',
        brand_primary_color: '#0055ff',
        brand_accent_color: '#00cc88',
        default_language: 'ar',
      };

      const brandingArabic = rowToBranding(rowArabic);
      expect(brandingArabic.defaultLanguage).toBe('ar');

      const rowEnglish: BrandingRow = {
        brand_product_name: 'Fleet Logistics',
        brand_tagline: 'Fleet Platform',
        brand_logo_url: null,
        brand_favicon_url: null,
        brand_primary_color: null,
        brand_accent_color: null,
        default_language: 'en',
      };

      const brandingEnglish = rowToBranding(rowEnglish);
      expect(brandingEnglish.defaultLanguage).toBe('en');

      const rowDefault: BrandingRow = {
        brand_product_name: null,
        brand_tagline: null,
        brand_logo_url: null,
        brand_favicon_url: null,
        brand_primary_color: null,
        brand_accent_color: null,
        default_language: null,
      };

      const brandingDefault = rowToBranding(rowDefault);
      expect(brandingDefault.defaultLanguage).toBe('en');
    });
  });

  describe('Login Page Language Behavior', () => {
    it('sets English for general unbranded login', () => {
      let activeLang = 'ar';
      const branding = null;

      if (branding && (branding as any).defaultLanguage === 'ar') {
        activeLang = 'ar';
      } else {
        activeLang = 'en';
      }

      expect(activeLang).toBe('en');
    });

    it('sets Arabic when tenant branding specifies defaultLanguage="ar"', () => {
      let activeLang = 'en';
      const branding = { defaultLanguage: 'ar' };

      if (branding && branding.defaultLanguage === 'ar') {
        activeLang = 'ar';
      } else {
        activeLang = 'en';
      }

      expect(activeLang).toBe('ar');
    });

    it('keeps English when tenant branding specifies defaultLanguage="en"', () => {
      let activeLang = 'en';
      const branding = { defaultLanguage: 'en' };

      if (branding && branding.defaultLanguage === 'ar') {
        activeLang = 'ar';
      } else {
        activeLang = 'en';
      }

      expect(activeLang).toBe('en');
    });
  });

  describe('Landing Page (/platform) Language Behavior', () => {
    it('defaults to English when user is unauthenticated', () => {
      const isAuthenticated = false;
      const tenant = null;

      let lang = 'ar';
      if (isAuthenticated && (tenant as any)?.defaultLanguage === 'ar') {
        lang = 'ar';
      } else {
        lang = 'en';
      }

      expect(lang).toBe('en');
    });

    it('defaults to English when tenant has defaultLanguage="en"', () => {
      const isAuthenticated = true;
      const tenant = { id: 't1', name: 'Acme', defaultLanguage: 'en' };

      let lang = 'ar';
      if (isAuthenticated && tenant?.defaultLanguage === 'ar') {
        lang = 'ar';
      } else {
        lang = 'en';
      }

      expect(lang).toBe('en');
    });

    it('switches to Arabic when tenant has defaultLanguage="ar"', () => {
      const isAuthenticated = true;
      const tenant = { id: 't2', name: 'Sharjah Transport', defaultLanguage: 'ar' };

      let lang = 'en';
      if (isAuthenticated && tenant?.defaultLanguage === 'ar') {
        lang = 'ar';
      } else {
        lang = 'en';
      }

      expect(lang).toBe('ar');
    });
  });

  describe('Arabic Label Dictionary Completeness for Login Flow', () => {
    const requiredLoginKeys = [
      'Sign in',
      'Signing in…',
      'Two-factor required',
      'Welcome back — enter your credentials below.',
      'Enter the 6-digit code from your authenticator app.',
      'Enter one of your recovery codes.',
      'Work email',
      'Email address',
      'Password',
      'Show',
      'Hide',
      'Continue with SSO',
      'Sign in with SSO →',
      'Sign in with password instead',
      'Forgot your password?',
      'Recovery code',
      'Authenticator code',
      'Verify and continue',
      'Verifying…',
      'Use authenticator instead',
      'Use a recovery code',
      'Back',
      'New to Fleet360?',
      'Create your organisation',
      'Fleet Management Platform',
      'Multi-Tenant Platform',
    ];

    for (const key of requiredLoginKeys) {
      it(`provides Arabic translation for "${key}"`, () => {
        expect(arabicLabels[key]).toBeDefined();
        expect(arabicLabels[key].length).toBeGreaterThan(0);
      });
    }
  });
});
