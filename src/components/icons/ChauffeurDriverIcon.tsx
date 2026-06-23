import type { LucideIcon, LucideProps } from 'lucide-react';

const ChauffeurDriverIcon = ((props: LucideProps) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.2 8.4c1.1-.8 2.9-1.4 5.8-1.4s4.7.6 5.8 1.4" />
      <path d="M7.6 7.6 8.8 4.8h6.4l1.2 2.8" />
      <path d="M8.4 9.2h7.2" />
      <path d="M8.2 12.1a3.8 3.8 0 0 0 7.6 0" />
      <path d="M8.5 11.1h7" />
      <path d="M10.1 16.1 12 18l1.9-1.9" />
      <path d="M5.2 21c.6-2.7 2.9-4.4 5.7-4.7" />
      <path d="M18.8 21c-.6-2.7-2.9-4.4-5.7-4.7" />
      <path d="M9.1 20.7h5.8" />
    </svg>
  );
}) as LucideIcon;

export default ChauffeurDriverIcon;
