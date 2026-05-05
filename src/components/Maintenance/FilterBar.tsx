import React, { useState, useEffect, useRef } from 'react';

interface FilterBarProps {
    onSearch: (term: string) => void;
    onDateRangeChange: (start: string, end: string) => void;
    onStatusChange: (statuses: string[]) => void;
    statusOptions: string[];
    placeholder?: string;
    defaultStartDate?: string;
    defaultEndDate?: string;
}

export default function FilterBar({
    onSearch,
    onDateRangeChange,
    onStatusChange,
    statusOptions,
    placeholder = "Search...",
    defaultStartDate = '',
    defaultEndDate = ''
}: FilterBarProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState(defaultStartDate);
    const [endDate, setEndDate] = useState(defaultEndDate);
    const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Handle click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsStatusDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch(searchTerm);
    };

    const handleDateChange = (type: 'start' | 'end', value: string) => {
        if (type === 'start') {
            setStartDate(value);
            onDateRangeChange(value, endDate);
        } else {
            setEndDate(value);
            onDateRangeChange(startDate, value);
        }
    };

    const toggleStatus = (status: string) => {
        const newStatuses = selectedStatuses.includes(status)
            ? selectedStatuses.filter(s => s !== status)
            : [...selectedStatuses, status];

        setSelectedStatuses(newStatuses);
        onStatusChange(newStatuses);
    };

    const selectAllStatuses = () => {
        if (selectedStatuses.length === statusOptions.length) {
            setSelectedStatuses([]);
            onStatusChange([]);
        } else {
            setSelectedStatuses(statusOptions);
            onStatusChange(statusOptions);
        }
    };

    return (
        <div className="bg-slate-900 p-4 rounded-xl border border-white/10 shadow-sm space-y-4 md:space-y-0 md:flex md:items-center md:gap-4">
            {/* Date Range */}
            <div className="flex items-center gap-2">
                <input
                    type="date"
                    className="rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={startDate}
                    onChange={(e) => handleDateChange('start', e.target.value)}
                    placeholder="Start Date"
                />
                <span className="text-slate-400">-</span>
                <input
                    type="date"
                    className="rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={endDate}
                    onChange={(e) => handleDateChange('end', e.target.value)}
                    placeholder="End Date"
                />
            </div>

            {/* Status Dropdown */}
            <div className="relative" ref={dropdownRef}>
                <button
                    type="button"
                    onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                    className="flex items-center gap-2 rounded-lg border border-white/15 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-slate-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                    Status
                    {selectedStatuses.length > 0 && (
                        <span className="ml-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-400">
                            {selectedStatuses.length}
                        </span>
                    )}
                </button>

                {isStatusDropdownOpen && (
                    <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 bg-slate-900 p-2 shadow-lg">
                        <div className="mb-2 border-b border-white/10 pb-2">
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                                <input
                                    type="checkbox"
                                    className="rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                    checked={selectedStatuses.length === statusOptions.length && statusOptions.length > 0}
                                    onChange={selectAllStatuses}
                                />
                                <span className="text-sm font-medium text-slate-300">Select All</span>
                            </label>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1">
                            {statusOptions.map((status) => (
                                <label key={status} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                                    <input
                                        type="checkbox"
                                        className="rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                        checked={selectedStatuses.includes(status)}
                                        onChange={() => toggleStatus(status)}
                                    />
                                    <span className="text-sm text-slate-400">{status}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Search Input */}
            <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2">
                <div className="relative flex-1">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-400">
                            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <input
                        type="text"
                        className="block w-full rounded-lg border border-white/15 bg-slate-800 py-2 pl-10 pr-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder={placeholder}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                    Search
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setSearchTerm('');
                        setStartDate(defaultStartDate);
                        setEndDate(defaultEndDate);
                        setSelectedStatuses([]);
                        onSearch('');
                        onDateRangeChange(defaultStartDate, defaultEndDate);
                        onStatusChange([]);
                    }}
                    className="rounded-lg border border-white/15 bg-slate-800 p-2 text-slate-400 hover:bg-white/5 hover:text-slate-300"
                    title="Reset Filters"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                </button>
            </form>
        </div>
    );
}
