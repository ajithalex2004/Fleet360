'use client';

/**
 * src/components/ui/PhoneInput.tsx
 *
 * Uniform Country Code Selector + Mobile Number Input for Fleet360.
 * Automatically synchronizes with E.164 international standard (`+<dialCode><nationalDigits>`).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  CountryMeta,
  parsePhoneNumber,
} from '@/lib/phone-format';
import { ChevronDown, Search, Check, Phone } from 'lucide-react';

export interface PhoneInputProps {
  value?: string | null;
  onChange?: (fullE164: string, meta: { country: CountryMeta; nationalNumber: string }) => void;
  defaultCountryIso?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  error?: boolean;
}

export default function PhoneInput({
  value = '',
  onChange,
  defaultCountryIso = 'AE',
  placeholder,
  disabled = false,
  required = false,
  className = '',
  id,
  name,
  error = false,
}: PhoneInputProps) {
  // Parse initial or incoming value
  const parsed = useMemo(
    () => parsePhoneNumber(value, defaultCountryIso),
    [value, defaultCountryIso]
  );

  const [selectedCountry, setSelectedCountry] = useState<CountryMeta>(parsed.country);
  const [nationalNumber, setNationalNumber] = useState<string>(parsed.nationalNumber);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);

  // Sync state if external value changes
  useEffect(() => {
    const nextParsed = parsePhoneNumber(value, defaultCountryIso);
    setSelectedCountry(nextParsed.country);
    setNationalNumber(nextParsed.nationalNumber);
  }, [value, defaultCountryIso]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [dropdownOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCountrySelect = (country: CountryMeta) => {
    setSelectedCountry(country);
    setDropdownOpen(false);

    const fullE164 = nationalNumber ? `${country.dialCode}${nationalNumber}` : '';
    onChange?.(fullE164, { country, nationalNumber });
    numberInputRef.current?.focus();
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only numbers and clean leading zeros
    const rawVal = e.target.value;
    const cleanDigits = rawVal.replace(/\D/g, '');
    setNationalNumber(cleanDigits);

    const fullE164 = cleanDigits ? `${selectedCountry.dialCode}${cleanDigits}` : '';
    onChange?.(fullE164, { country: selectedCountry, nationalNumber: cleanDigits });
  };

  // Filter countries by name or dial code
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return COUNTRIES;
    const q = searchQuery.toLowerCase().trim();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div
        className={`flex items-center rounded-xl border transition-all duration-150 bg-[var(--bg-canvas)] overflow-hidden ${
          disabled ? 'opacity-60 cursor-not-allowed bg-[var(--bg-surface)]' : ''
        } ${
          error
            ? 'border-rose-500 ring-1 ring-rose-500/20'
            : dropdownOpen
            ? 'border-cyan-500 ring-2 ring-cyan-500/20'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
        }`}
      >
        {/* Country Code Trigger Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border-r border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold shrink-0 transition-colors cursor-pointer select-none"
          title={`${selectedCountry.name} (${selectedCountry.dialCode})`}
        >
          <span className="text-base leading-none">{selectedCountry.flag}</span>
          <span className="font-mono text-xs">{selectedCountry.dialCode}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* National Number Input */}
        <div className="relative flex-1 flex items-center">
          <input
            ref={numberInputRef}
            id={id}
            name={name}
            type="tel"
            disabled={disabled}
            required={required}
            value={nationalNumber}
            onChange={handleNumberChange}
            placeholder={placeholder || selectedCountry.placeholder}
            className="w-full bg-transparent px-3 py-2 text-xs sm:text-sm font-mono text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none"
            autoComplete="tel-national"
          />
        </div>
      </div>

      {/* Country Selection Dropdown */}
      {dropdownOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-72 sm:w-80 max-h-72 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
          {/* Search Header */}
          <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search country or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Country List */}
          <div className="overflow-y-auto flex-1 divide-y divide-[var(--border-subtle)]/30 text-xs">
            {filteredCountries.length === 0 ? (
              <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                No country found matching &quot;{searchQuery}&quot;
              </div>
            ) : (
              filteredCountries.map((c) => {
                const isSelected = c.iso === selectedCountry.iso;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    onClick={() => handleCountrySelect(c)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      isSelected
                        ? 'bg-cyan-500/10 text-cyan-400 font-semibold'
                        : 'text-[var(--text-main)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <span className="text-lg leading-none shrink-0">{c.flag}</span>
                      <span className="truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">
                        {c.dialCode}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
