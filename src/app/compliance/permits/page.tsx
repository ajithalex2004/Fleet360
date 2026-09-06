'use client';

import React, { useState } from 'react';

export default function PermitsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Permits</h1>
        <p className="text-xs text-[var(--text-muted)]">Manage business permits and licenses</p>
      </div>

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-8 text-center">
        <p className="text-[var(--text-muted)] text-lg">Permits management page coming soon</p>
        <p className="text-[var(--text-faint)] text-sm mt-2">This feature is under development</p>
      </div>
    </div>
  );
}
