'use client';

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import { getMaintenanceRequests } from "@/services/mockData";
import { MaintenanceRequest, MaintenanceStatus } from "@/types/maintenance";

export default function GarageWorkOrdersPage() {
    const router = useRouter();
    const [workOrders, setWorkOrders] = useState<MaintenanceRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchFilter, setSearchFilter] = useState("");
    const [dateFilter, setDateFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("All Status");

    // Hardcoded Garage ID for demo
    const currentGarageId = 'g1';

    useEffect(() => {
        const loadData = async () => {
            try {
                const allRequests = await getMaintenanceRequests();

                // Filter for Work Orders
                const workOrderRequests = allRequests.filter(r =>
                    (r.garageId === currentGarageId) &&
                    (r.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                        r.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                        r.status === MaintenanceStatus.PENDING_INVOICE ||
                        r.status === MaintenanceStatus.CLOSED)
                );
                setWorkOrders(workOrderRequests);

            } catch (error) {
                console.error("Error loading work orders:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const filteredWorkOrders = useMemo(() => {
        return workOrders.filter(wo => {
            const matchesSearch = searchFilter === "" ||
                wo.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
                wo.workOrderNo?.toLowerCase().includes(searchFilter.toLowerCase()) ||
                wo.description.toLowerCase().includes(searchFilter.toLowerCase());

            const matchesDate = dateFilter === "" || wo.requestDate.startsWith(dateFilter);

            const matchesStatus = statusFilter === "All Status" || wo.status === statusFilter;

            return matchesSearch && matchesDate && matchesStatus;
        });
    }, [workOrders, searchFilter, dateFilter, statusFilter]);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Top Bar */}
            <header className="flex items-center justify-between px-4 py-3 bg-white shadow-sm md:px-6 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold">
                        G
                    </div>
                    <div className="font-semibold text-slate-800 text-sm md:text-base">Garage Portal</div>
                </div>
                <div className="text-xs text-slate-600 md:text-sm">
                    Logged in as <span className="font-medium">Autopro Service Centre</span>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6">
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h2 className="text-2xl font-bold text-slate-800">Work Orders</h2>
                        <div className="flex flex-col sm:flex-row gap-2 text-sm">
                            <input
                                type="text"
                                placeholder="Search WO or Description..."
                                value={searchFilter}
                                onChange={(e) => setSearchFilter(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-64"
                            />
                            <input
                                type="date"
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                            >
                                <option value="All Status">All Status</option>
                                <option value={MaintenanceStatus.UNDER_MAINTENANCE}>{MaintenanceStatus.UNDER_MAINTENANCE}</option>
                                <option value={MaintenanceStatus.MAINTENANCE_COMPLETED}>{MaintenanceStatus.MAINTENANCE_COMPLETED}</option>
                                <option value={MaintenanceStatus.PENDING_INVOICE}>{MaintenanceStatus.PENDING_INVOICE}</option>
                                <option value={MaintenanceStatus.CLOSED}>Closed</option>
                            </select>
                        </div>
                    </div>

                    {filteredWorkOrders.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-2xl shadow-sm">
                            <p className="text-slate-500">No work orders found.</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {filteredWorkOrders.map(wo => (
                                <div
                                    key={wo.id}
                                    onClick={() => router.push(`/maintenance/work-orders/${encodeURIComponent(wo.id)}`)}
                                    className="bg-white rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-blue-500/30 group"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="font-mono text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                            {wo.workOrderNo || `WO-${wo.id.toUpperCase()}`}
                                        </span>
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${wo.status === MaintenanceStatus.MAINTENANCE_COMPLETED ? 'bg-green-50 text-green-700' :
                                            wo.status === MaintenanceStatus.UNDER_MAINTENANCE ? 'bg-blue-50 text-blue-700' :
                                                'bg-slate-100 text-slate-700'
                                            }`}>
                                            {wo.status}
                                        </span>
                                    </div>
                                    <h3 className="font-semibold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors line-clamp-1">
                                        {wo.description}
                                    </h3>
                                    <div className="text-xs text-slate-500 mb-4">
                                        Started: {new Date(wo.requestDate).toLocaleDateString()}
                                    </div>
                                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                                        <span className="text-xs font-medium text-slate-600">Open Work Order</span>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400 group-hover:text-blue-500">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                                        </svg>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            <footer className="py-3 text-center text-[11px] text-slate-400">
                Powered by TRIPXL.AI
            </footer>
        </div>
    );
}
