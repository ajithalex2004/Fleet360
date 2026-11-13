'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileCheck } from 'lucide-react';

export default function DeprecatedHandoverRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/rental/counter');
  }, [router]);

  return (
    <div className="max-w-xl mx-auto mt-12 rounded-2xl bg-[var(--bg-surface)]/70 border border-teal-500/30 p-8 text-center space-y-4 shadow-lg">
      <div className="w-12 h-12 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center mx-auto">
        <FileCheck className="h-6 w-6 text-teal-400" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold text-[var(--text-main)]">
          Handover Consolidated into Counter Desk
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Vehicle pick-up check-outs, walkaround inspections, digital signatures, and return settlements are now unified in the RAC Counter Desk. Redirecting you automatically…
        </p>
      </div>
      <div className="pt-2">
        <Link
          href="/rental/counter"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 transition"
        >
          Go to Unified Pick-Up &amp; Return Desk →
        </Link>
      </div>
    </div>
  );
}
