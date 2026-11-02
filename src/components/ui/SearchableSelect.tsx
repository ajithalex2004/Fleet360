'use client';

import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Search, X, Check, type LucideIcon } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  group?: string;
  badge?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  id?: string;
  required?: boolean;
  isClearable?: boolean;
  emptyText?: string;
  accent?: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose';
  addonAction?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    title?: string;
    variant?: 'blue' | 'emerald' | 'amber';
  };
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  searchPlaceholder = 'Type to search...',
  disabled = false,
  className = '',
  name,
  id,
  isClearable = false,
  emptyText = 'No matching options found',
  accent = 'blue',
  addonAction,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const selectId = id || generatedId;

  // Selected Option
  const selectedOption = useMemo(() => {
    return options.find((opt) => opt.value === value) || null;
  }, [options, value]);

  // Filtered Options
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q)) ||
        (opt.group && opt.group.toLowerCase().includes(q))
    );
  }, [options, search]);

  // Grouped items
  const groupedOptions = useMemo(() => {
    const groups: Array<{ name: string; items: SearchableSelectOption[] }> = [];
    const ungrouped: SearchableSelectOption[] = [];

    filteredOptions.forEach((opt) => {
      if (!opt.group) {
        ungrouped.push(opt);
      } else {
        let g = groups.find((grp) => grp.name === opt.group);
        if (!g) {
          g = { name: opt.group, items: [] };
          groups.push(g);
        }
        g.items.push(opt);
      }
    });

    return { groups, ungrouped };
  }, [filteredOptions]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      setHighlightedIndex(0);
    }
  }, [isOpen]);

  // Handle Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          const target = filteredOptions[highlightedIndex];
          if (!target.disabled) {
            onChange(target.value);
            setIsOpen(false);
            setSearch('');
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearch('');
        break;
      case 'Tab':
        setIsOpen(false);
        setSearch('');
        break;
    }
  };

  const handleSelect = (opt: SearchableSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  // Accent styles
  const accentBorder = {
    blue: 'focus:border-blue-500 focus-within:border-blue-500',
    emerald: 'focus:border-emerald-500 focus-within:border-emerald-500',
    amber: 'focus:border-amber-500 focus-within:border-amber-500',
    violet: 'focus:border-violet-500 focus-within:border-violet-500',
    rose: 'focus:border-rose-500 focus-within:border-rose-500',
  }[accent];

  const addonStyles = {
    blue: 'bg-blue-600/15 border-blue-500/30 text-blue-400 hover:bg-blue-600 hover:text-white',
    emerald: 'bg-emerald-600/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-600 hover:text-white',
    amber: 'bg-amber-600/15 border-amber-500/30 text-amber-400 hover:bg-amber-600 hover:text-white',
  }[addonAction?.variant || 'blue'];

  let flatIndex = 0;

  return (
    <div className={`relative ${className}`} ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Hidden input for standard forms */}
      {name && <input type="hidden" name={name} value={value} />}

      <div className="flex items-center gap-1.5">
        {/* Main Select Trigger Box */}
        <div
          id={selectId}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          tabIndex={disabled ? -1 : 0}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`flex-1 min-w-0 flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] cursor-pointer select-none transition-all shadow-sm ${accentBorder} ${
            disabled ? 'opacity-50 cursor-not-allowed bg-[var(--bg-main)]' : 'hover:border-[var(--border-strong)]'
          } ${isOpen ? 'ring-1 ring-blue-500 border-blue-500' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
            {selectedOption?.icon && (
              <selectedOption.icon className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            )}
            {selectedOption ? (
              <div className="truncate font-medium text-[var(--text-main)] flex items-center gap-1.5">
                <span className="truncate">{selectedOption.label}</span>
                {selectedOption.badge && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] shrink-0">
                    {selectedOption.badge}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[var(--text-muted)] truncate">{placeholder}</span>
            )}
          </div>

          <div className="flex items-center gap-1 ml-1.5 shrink-0">
            {isClearable && value && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded transition-colors"
                title="Clear selection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${
                isOpen ? 'rotate-180 text-blue-400' : ''
              }`}
            />
          </div>
        </div>

        {/* Optional Addon Action Button (e.g. + New) */}
        {addonAction && (
          <button
            type="button"
            disabled={disabled}
            onClick={addonAction.onClick}
            title={addonAction.title || addonAction.label}
            className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border font-semibold text-xs shrink-0 transition-all shadow-sm ${addonStyles} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {addonAction.icon ? (
              <addonAction.icon className="w-3.5 h-3.5 shrink-0" />
            ) : null}
            <span>{addonAction.label}</span>
          </button>
        )}
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-1.5 rounded-xl bg-[var(--bg-surface-elevated,var(--bg-surface))] border border-[var(--border-subtle)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          style={{ minWidth: '280px', maxWidth: '100%' }}
        >
          {/* Search Box Header */}
          <div className="p-2 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/60">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-muted)] outline-none focus:border-blue-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div
            ref={listRef}
            role="listbox"
            className="max-h-60 overflow-y-auto p-1 text-xs divide-y divide-[var(--border-subtle)]/40 scrollbar-thin"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                {emptyText}
              </div>
            ) : (
              <>
                {/* 1. Grouped Options */}
                {groupedOptions.groups.map((group) => (
                  <div key={group.name} className="py-1">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-400/90 select-none bg-[var(--bg-main)]/40 rounded">
                      {group.name}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {group.items.map((opt) => {
                        const isSelected = opt.value === value;
                        const isHighlighted = flatIndex === highlightedIndex;
                        const currIndex = flatIndex++;
                        return (
                          <div
                            key={opt.value}
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setHighlightedIndex(currIndex)}
                            onClick={() => handleSelect(opt)}
                            className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-600 text-white font-semibold'
                                : isHighlighted
                                ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)]'
                                : 'text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
                            } ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="truncate font-medium">{opt.label}</div>
                              {opt.sublabel && (
                                <div
                                  className={`text-[10px] truncate ${
                                    isSelected ? 'text-white/80' : 'text-[var(--text-muted)]'
                                  }`}
                                >
                                  {opt.sublabel}
                                </div>
                              )}
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* 2. Ungrouped Options */}
                {groupedOptions.ungrouped.length > 0 && (
                  <div className="py-0.5 space-y-0.5">
                    {groupedOptions.groups.length > 0 && (
                      <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                        All Options
                      </div>
                    )}
                    {groupedOptions.ungrouped.map((opt) => {
                      const isSelected = opt.value === value;
                      const isHighlighted = flatIndex === highlightedIndex;
                      const currIndex = flatIndex++;
                      return (
                        <div
                          key={opt.value}
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setHighlightedIndex(currIndex)}
                          onClick={() => handleSelect(opt)}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white font-semibold'
                              : isHighlighted
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)]'
                              : 'text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
                          } ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="truncate font-medium">{opt.label}</div>
                            {opt.sublabel && (
                              <div
                                className={`text-[10px] truncate ${
                                  isSelected ? 'text-white/80' : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {opt.sublabel}
                              </div>
                            )}
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default SearchableSelect;
