import React from 'react';
import type { Metadata } from 'next';
import { Archivo, Plus_Jakarta_Sans, Red_Hat_Mono } from 'next/font/google';
import './platform-theme.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-pf-headline',
  display: 'swap',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pf-body',
  display: 'swap',
});

const redHatMono = Red_Hat_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-pf-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Enterprise Directory',
  description: 'Fleet360 Enterprise split directory & live module inspector across all 24 mobility modules.',
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} ${plusJakartaSans.variable} ${redHatMono.variable}`}>
      {children}
    </div>
  );
}
