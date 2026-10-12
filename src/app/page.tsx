import type { Metadata } from 'next';
import MarketingHero from '@/components/marketing/MarketingHero';
import AgentOrchestration from '@/components/marketing/AgentOrchestration';
import UnifiedPlatform from '@/components/marketing/UnifiedPlatform';
import OperationalOutcomes from '@/components/marketing/OperationalOutcomes';
import GccIntelligence from '@/components/marketing/GccIntelligence';

export const metadata: Metadata = {
  title: 'Fleet360 | AI-Orchestrated Fleet Intelligence',
  description:
    'Unify vehicles, drivers, routes, maintenance, finance, and compliance through one AI-orchestrated fleet operations platform.',
};

export default function Home() {
  return (
    <>
      <MarketingHero />
      <AgentOrchestration />
      <UnifiedPlatform />
      <OperationalOutcomes />
      <GccIntelligence />
    </>
  );
}
