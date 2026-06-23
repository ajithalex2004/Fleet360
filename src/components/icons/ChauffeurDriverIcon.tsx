/**
 * Stub for the missing ChauffeurDriverIcon component referenced from
 * src/app/logistics/page.tsx. The original implementation was either
 * never committed or deleted in a cleanup pass; this stub renders a
 * neutral driver-shaped icon so the page (and therefore the production
 * Next.js build) compiles.
 *
 * Replace with the real implementation when the design system file is
 * restored.
 */
import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export default function ChauffeurDriverIcon({ className, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Head */}
      <circle cx="12" cy="8" r="3.5" />
      {/* Steering-wheel hint below the head */}
      <circle cx="12" cy="17" r="4" />
      <path d="M12 13v8" />
      <path d="M8 17h8" />
    </svg>
  );
}
