'use client';

import { useState, forwardRef, InputHTMLAttributes } from 'react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Extra className forwarded to the <input> element */
  className?: string;
  /** Extra className forwarded to the wrapper <div> */
  wrapperClassName?: string;
}

/**
 * A drop-in replacement for <input type="password"> that adds a
 * show/hide toggle button on the right side of the field.
 *
 * Usage:
 *   import PasswordInput from '@/components/ui/PasswordInput';
 *   <PasswordInput value={pw} onChange={e => setPw(e.target.value)} className="..." />
 */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className = '', wrapperClassName = '', ...props }, ref) => {
    const [show, setShow] = useState(false);

    return (
      <div className={`relative ${wrapperClassName}`}>
        <input
          {...props}
          ref={ref}
          type={show ? 'text' : 'password'}
          className={`${className} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-white transition-colors"
        >
          {show ? (
            /* Eye-off icon */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            /* Eye icon */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;
