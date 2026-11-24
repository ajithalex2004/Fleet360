import { Carlito } from 'next/font/google';

// Calibri is used where installed (Windows / Office); Carlito is its
// metric-compatible open-source twin, self-hosted as the fallback.
export const carlito = Carlito({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-carlito',
  display: 'swap',
});
