'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MaintenanceRequest, MaintenanceStatus, Garage, Vehicle } from '@/types/maintenance';
import { getMaintenanceRequests, getGarages, getVehicles } from '@/services/mockData';
import { formatCurrency } from '@/utils/currency';

export default function WorkOrderListPage() {
    const router = useRouter();
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [garages, setGarages] = useState<Record<string, Garage>>({});
    const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
    const [loading, setLoading] = useState(true);

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [allRequests, allGarages, allVehicles] = await Promise.all([
                    getMaintenanceRequests(),
                    getGarages(),
                    getVehicles()
                ]);

                // Filter for requests that have reached the work order stage
                const workOrderRequests = allRequests.filter(r =>
                    r.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                    r.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                    r.status === MaintenanceStatus.PENDING_INVOICE ||
                    r.status === MaintenanceStatus.CLOSED
                );

                setRequests(workOrderRequests);

                // Create maps for easy lookup
                const garageMap = allGarages.reduce((acc, g) => {
                    acc[g.id] = g;
                    return acc;
                }, {} as Record<string, Garage>);
                setGarages(garageMap);

                const vehicleMap = allVehicles.reduce((acc, v) => {
                    acc[v.id] = v;
                    return acc;
                }, {} as Record<string, Vehicle>);
                setVehicles(vehicleMap);

            } catch (error) {
                console.error('Error loading work orders:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const filteredRequests = useMemo(() => {
        return requests.filter(req => {
            // Status Filter
            if (statusFilter !== 'All' && req.status !== statusFilter) return false;

            // Search Filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const vehicle = vehicles[req.vehicleId];
                const garage = req.garageId ? garages[req.garageId] : null;

                return (
                    req.id.toLowerCase().includes(query) ||
                    req.workOrderNo?.toLowerCase().includes(query) ||
                    vehicle?.licensePlate.toLowerCase().includes(query) ||
                    garage?.name.toLowerCase().includes(query)
                );
            }

            return true;
        });
    }, [requests, statusFilter, searchQuery, vehicles, garages]);

    const getStatusBadgeColor = (status: MaintenanceStatus) => {
        switch (status) {
            case MaintenanceStatus.UNDER_MAINTENANCE:
                return 'bg-blue-500/20 text-blue-300';
            case MaintenanceStatus.MAINTENANCE_COMPLETED:
                return 'bg-emerald-500/20 text-emerald-300';
            case MaintenanceStatus.PENDING_INVOICE:
                return 'bg-amber-500/20 text-amber-300';
            case MaintenanceStatus.CLOSED:
                return 'bg-slate-700/40 text-slate-200';
            default:
                return 'bg-slate-700/40 text-slate-200';
        }
    };

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-slate-500">Loading work orders...</div>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Work Orders</h1>
                    <p className="mt-1 text-sm text-slate-500">Manage and track all maintenance work orders</p>
                </div>
            </div>

            {/* Filters */}
            <div className="mb-6 grid gap-4 md:grid-cols-3">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search WO #, Vehicle, or Garage..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-white/15 pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                    />
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                >
                    <option value="All">All Statuses</option>
                    <option value={MaintenanceStatus.UNDER_MAINTENANCE}>Under Maintenance</option>
                    <option value={MaintenanceStatus.MAINTENANCE_COMPLETED}>Maintenance Completed</option>
                    <option value={MaintenanceStatus.PENDING_INVOICE}>Pending Invoice</option>
                    <option value={MaintenanceStatus.CLOSED}>Closed</option>
                </select>
            </div>

            {/* List */}
            <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <table className="min-w-full divide-y divide-white/10">
                    <thead className="bg-slate-800/50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Work Order</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Vehicle</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Garage</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Start Date</th>
                            <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">Est. Cost</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-slate-900">
                        {filteredRequests.length > 0 ? (
                            filteredRequests.map((req) => {
                                const vehicle = vehicles[req.vehicleId];
                                const garage = req.garageId ? garages[req.garageId] : null;

                                return (
                                    <tr
                                        key={req.id}
                                        onClick={() => router.push(`/maintenance/work-orders/${req.id}`)}
                                        className="cursor-pointer hover:bg-white/5 transition-colors"
                                    >
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-blue-600 hover:underline">
                                                    {req.workOrderNo || `WO-${req.id.toUpperCase()}`}
                                                </span>
                                                <span className="text-xs text-slate-300">Req: {req.id.toUpperCase()}</span>
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-white">
                                                    {vehicle?.make} {vehicle?.model}
                                                </span>
                                                <span className="text-xs text-slate-300">{vehicle?.licensePlate}</span>
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="text-sm text-white">{garage?.name || 'N/A'}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${getStatusBadgeColor(req.status)}`}>
                                                {req.status}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-300">
                                            {new Date(req.requestDate).toLocaleDateString()}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-white">
                                            {req.estimatedCost ? formatCurrency(req.estimatedCost) : '-'}
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-300">
                                    No work orders found matching your filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
