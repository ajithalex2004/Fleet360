import type { Metadata } from 'next';
import MarketingHero from '@/components/marketing/MarketingHero';

export const metadata: Metadata = {
  title: 'Fleet360 | AI-Orchestrated Fleet Intelligence',
  description:
    'Unify vehicles, drivers, routes, maintenance, finance, and compliance through one AI-orchestrated fleet operations platform.',
};

export default function Home() {
  return <MarketingHero />;
}
