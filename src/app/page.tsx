import type { Metadata } from 'next';
import MarketingHero from '@/components/marketing/MarketingHero';
import AgentOrchestration from '@/components/marketing/AgentOrchestration';
import UnifiedPlatform from '@/components/marketing/UnifiedPlatform';
import OperationalOutcomes from '@/components/marketing/OperationalOutcomes';
import GccIntelligence from '@/components/marketing/GccIntelligence';
import GovernedAi from '@/components/marketing/GovernedAi';
import FinalConversion from '@/components/marketing/FinalConversion';
import HomepageAnalytics from '@/components/marketing/HomepageAnalytics';
import { getHomepageSnapshot } from '@/lib/public-homepage';

export const metadata: Metadata = {
  title: 'Fleet360 | AI-Orchestrated Fleet Intelligence',
  description:
    'Unify vehicles, drivers, routes, maintenance, finance, and compliance through one AI-orchestrated fleet operations platform.',
};

export const revalidate = 60;

export default function Home() {
  const snapshot = getHomepageSnapshot();
  return (
    <>
      <HomepageAnalytics />
      <MarketingHero snapshot={snapshot} />
      <AgentOrchestration />
      <UnifiedPlatform />
      <OperationalOutcomes />
      <GccIntelligence />
      <GovernedAi />
      <FinalConversion />
    </>
  );
}
