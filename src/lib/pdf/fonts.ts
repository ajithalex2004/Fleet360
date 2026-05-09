/**
 * Font registration for @react-pdf/renderer (server-side only).
 *
 * Two font families:
 *   - 'Noto Sans'        — Latin text (English, numerals)
 *   - 'Noto Sans Arabic' — Arabic text, with proper shaping for connected forms
 *
 * Files live in public/fonts/ and are read from disk at module load (not
 * fetched at render time — keeps PDF generation deterministic and offline-safe).
 *
 * Idempotent: registerFonts() may be called multiple times safely; the second
 * call is a no-op once the SDK has the font registered.
 */

import path from 'node:path';
import { Font } from '@react-pdf/renderer';

let registered = false;

const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');

export function registerFonts() {
  if (registered) return;

  Font.register({
    family: 'Noto Sans',
    fonts: [
      { src: path.join(FONTS_DIR, 'NotoSans-Regular.ttf'), fontWeight: 'normal' },
      { src: path.join(FONTS_DIR, 'NotoSans-Bold.ttf'), fontWeight: 'bold' },
    ],
  });

  Font.register({
    family: 'Noto Sans Arabic',
    fonts: [
      { src: path.join(FONTS_DIR, 'NotoSansArabic-Regular.ttf'), fontWeight: 'normal' },
      { src: path.join(FONTS_DIR, 'NotoSansArabic-Bold.ttf'), fontWeight: 'bold' },
    ],
  });

  // Disable hyphenation for Arabic — Arabic text doesn't break that way.
  Font.registerHyphenationCallback(word => [word]);

  registered = true;
}
