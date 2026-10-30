'use client';

/**
 * src/components/ui/PhoneCell.tsx
 *
 * Uniform Mobile Number Table Cell and Display Component.
 * Formats any raw mobile string with country flag, formatted dial code,
 * click-to-call (tel:), and quick copy.
 */

import React, { useState } from 'react';
import { parsePhoneNumber, formatPhoneNumberDisplay } from '@/lib/phone-format';
import { Phone, Copy, Check } from 'lucide-react';

interface PhoneCellProps {
  value?: string | null;
  className?: string;
  showIcon?: boolean;
  enableCall?: boolean;
}

export default function PhoneCell({
  value,
  className = '',
  showIcon = false,
  enableCall = true,
}: PhoneCellProps) {
  const [copied, setCopied] = useState(false);

  if (!value || typeof value !== 'string' || !value.trim()) {
    return <span className="text-[var(--text-faint)] italic">—</span>;
  }

  const { nationalNumber, fullE164 } = parsePhoneNumber(value);

  if (!nationalNumber) {
    return <span className="text-[var(--text-muted)] font-mono text-xs">{value}</span>;
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (fullE164) {
      navigator.clipboard.writeText(fullE164);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const formattedDisplay = formatPhoneNumberDisplay(value);

  return (
    <div className={`inline-flex items-center gap-1.5 group select-none ${className}`}>
      {enableCall && fullE164 ? (
        <a
          href={`tel:${fullE164}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[var(--text-main)] hover:text-cyan-400 font-mono text-xs transition-colors"
          title={`Call ${fullE164}`}
        >
          {showIcon && <Phone className="w-3 h-3 text-[var(--text-muted)]" />}
          <span>{formattedDisplay}</span>
        </a>
      ) : (
        <span className="text-[var(--text-main)] font-mono text-xs">
          {formattedDisplay}
        </span>
      )}

      {fullE164 && (
        <button
          type="button"
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--bg-surface-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-main)] transition-opacity"
          title="Copy phone number"
        >
          {copied ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      )}
    </div>
  );
}
