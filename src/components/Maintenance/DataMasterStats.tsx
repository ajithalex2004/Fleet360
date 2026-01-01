import React from 'react';

interface DataMasterStatsProps {
    title: string;
    stats: {
        total: number;
        active: number;
        inactive: number;
        hierarchies: number;
    };
    onAddNew: () => void;
    addNewLabel?: string;
}

export function DataMasterStats({ title, stats, onAddNew, addNewLabel = 'Add New' }: DataMasterStatsProps) {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
                <button
                    onClick={onAddNew}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    {addNewLabel}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total */}
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-4xl font-bold text-slate-900">{stats.total}</span>
                        <div className="p-2 bg-pink-100 rounded-lg text-pink-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-4.5H12.5" />
                            </svg>
                        </div>
                    </div>
                    <span className="text-slate-500 font-medium">Total Vehicles</span>
                </div>

                {/* Active */}
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-4xl font-bold text-slate-900">{stats.active}</span>
                        <div className="p-2 bg-green-100 rounded-lg text-green-600">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                            </svg>
                        </div>
                    </div>
                    <span className="text-slate-500 font-medium">Active Vehicles</span>
                </div>

                {/* Inactive */}
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-4xl font-bold text-slate-900">{stats.inactive}</span>
                        <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
                            </svg>
                        </div>
                    </div>
                    <span className="text-slate-500 font-medium">Inactive Vehicles</span>
                </div>

                {/* Hierarchies */}
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-4xl font-bold text-slate-900">{stats.hierarchies}</span>
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                <path fillRule="evenodd" d="M3 6a3 3 0 013-3h2.25a3 3 0 013 3v2.25a3 3 0 01-3 3H6a3 3 0 01-3-3V6zm9.75 0a3 3 0 013-3H18a3 3 0 013 3v2.25a3 3 0 01-3 3h-2.25a3 3 0 01-3-3V6zM3 15.75a3 3 0 013-3h2.25a3 3 0 013 3V18a3 3 0 01-3 3H6a3 3 0 01-3-3v-2.25zm9.75 0a3 3 0 013-3H18a3 3 0 013 3V18a3 3 0 01-3 3h-2.25a3 3 0 01-3-3v-2.25z" clipRule="evenodd" />
                            </svg>
                        </div>
                    </div>
                    <span className="text-slate-500 font-medium">Hierarchies</span>
                </div>
            </div>
        </div>
    );
}
