'use client';

import { useEffect } from 'react';

type EventName = 'homepage_view' | 'homepage_section_view' | 'homepage_cta_click' | 'review_request_submitted';

function track(event: EventName, properties: Record<string, string> = {}) {
  const payload = JSON.stringify({ event, path: window.location.pathname, ...properties });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/public/analytics', new Blob([payload], { type: 'application/json' }));
  } else {
    void fetch('/api/public/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => undefined);
  }
}

export default function HomepageAnalytics() {
  useEffect(() => {
    track('homepage_view');
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-analytics-section]'));
    const seen = new Set<string>();
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const id = (entry.target as HTMLElement).dataset.analyticsSection;
      if (entry.isIntersecting && id && !seen.has(id)) { seen.add(id); track('homepage_section_view', { section: id }); }
    }), { threshold: 0.35 });
    sections.forEach((section) => observer.observe(section));
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-analytics-cta]');
      if (target?.dataset.analyticsCta) track('homepage_cta_click', { cta: target.dataset.analyticsCta });
    };
    document.addEventListener('click', onClick);
    return () => { observer.disconnect(); document.removeEventListener('click', onClick); };
  }, []);
  return null;
}

export function trackReviewRequestSubmitted() {
  if (typeof window !== 'undefined') track('review_request_submitted');
}
