import type { Metadata } from 'next';
import HomeHero from '@/components/marketing/HomeHero';
import AgentOrchestration from '@/components/marketing/AgentOrchestration';
import UnifiedPlatform from '@/components/marketing/UnifiedPlatform';
import LiveProductStage from '@/components/marketing/LiveProductStage';
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
    <main style={{ background: '#020908', color: '#f4f4ed' }}>
      <HomepageAnalytics />
      <HomeHero snapshot={snapshot} />
      <AgentOrchestration />
      <UnifiedPlatform />
      <LiveProductStage snapshot={snapshot} />
      <OperationalOutcomes />
      <GccIntelligence />
      <GovernedAi />
      <FinalConversion />
    </main>
  );
}
