import type { Metadata, Viewport } from 'next';
import LiveProductStage from '@/components/marketing/LiveProductStage';
import HomepageAnalytics from '@/components/marketing/HomepageAnalytics';
import {
  EditorialHero,
  ModuleStrip,
  EditorialPlatform,
  EditorialAgents,
  EditorialRegion,
  EditorialGovernance,
  EditorialOutcomes,
  EditorialFaq,
  EditorialClosing,
  EditorialFooter,
  editorialPageClass,
  skipLinkClass,
  FAQ_ITEMS,
} from '@/components/marketing/editorial/EditorialHome';
import { SiteHeader, RevealOnScroll } from '@/components/marketing/editorial/SiteChrome';
import { carlito } from '@/components/marketing/editorial/font';
import { getHomepageSnapshot } from '@/lib/public-homepage';
import { getSiteUrl } from '@/lib/site-url';

const TITLE = 'Fleet360 | AI-Orchestrated Fleet Intelligence for the UAE & GCC';
const DESCRIPTION =
  'Unify vehicles, drivers, routes, maintenance, finance and compliance in one fleet operations platform, orchestrated by governed AI agents. Built for the UAE and GCC.';

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: '/', siteName: 'Fleet360', title: TITLE, description: DESCRIPTION, locale: 'en_AE' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#fbfaf7' };

function structuredData() {
  const site = getSiteUrl().origin;
  return JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Fleet360', url: site, logo: `${site}/icon-512.png`, areaServed: ['AE', 'SA', 'QA', 'OM', 'BH', 'KW'] },
    {
      '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Fleet360', applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android, iOS', url: site, description: DESCRIPTION,
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ]).replace(/</g, '\\u003c');
}

export const revalidate = 60;

export default function Home() {
  const snapshot = getHomepageSnapshot();
  return (
    <div className={`${editorialPageClass} ${carlito.variable}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData() }} />
      <a className={skipLinkClass} href="#main">Skip to content</a>
      <HomepageAnalytics />
      <RevealOnScroll />
      <SiteHeader />
      <main id="main">
        <EditorialHero snapshot={snapshot} />
        <ModuleStrip />
        <EditorialPlatform />
        <EditorialAgents />
        <div id="drayage" data-chapter="§ 03 Live product">
          <LiveProductStage snapshot={snapshot} />
        </div>
        <EditorialRegion />
        <EditorialGovernance />
        <EditorialOutcomes snapshot={snapshot} />
        <EditorialFaq />
        <EditorialClosing />
      </main>
      <EditorialFooter />
    </div>
  );
}
