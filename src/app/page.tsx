import type { Metadata } from 'next';
import { Carlito } from 'next/font/google';
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
  EditorialClosing,
  editorialPageClass,
} from '@/components/marketing/editorial/EditorialHome';
import { getHomepageSnapshot } from '@/lib/public-homepage';

// Calibri is used where installed (Windows / Office); Carlito is its
// metric-compatible open-source twin, self-hosted as the fallback.
const carlito = Carlito({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-carlito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fleet360 | AI-Orchestrated Fleet Intelligence',
  description:
    'Unify vehicles, drivers, routes, maintenance, finance, and compliance through one AI-orchestrated fleet operations platform.',
};

export const revalidate = 60;

export default function Home() {
  const snapshot = getHomepageSnapshot();
  return (
    <main className={`${editorialPageClass} ${carlito.variable}`}>
      <HomepageAnalytics />
      <EditorialHero snapshot={snapshot} />
      <ModuleStrip />
      <EditorialPlatform />
      <EditorialAgents />
      <LiveProductStage snapshot={snapshot} />
      <EditorialRegion />
      <EditorialGovernance />
      <EditorialOutcomes snapshot={snapshot} />
      <EditorialClosing />
    </main>
  );
}
