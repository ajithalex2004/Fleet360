'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Vehicle,
    Garage,
    MaintenanceType,
    MaintenancePriority,
    AttachmentType
} from '@/types/maintenance';
import {
    getVehicles,
    getGarages,
    createMaintenanceRequest,
    getDrivers
} from '@/services/mockData';

// Comprehensive Maintenance Jobs Database
const MAINTENANCE_JOBS_DATABASE = {
    [MaintenanceType.PREVENTIVE]: [
        'Oil Change',
        'Oil Filter Replacement',
        'Air Filter Replacement',
        'Cabin Filter Replacement',
        'Fuel Filter Replacement',
        'Tire Rotation',
        'Tire Pressure Check',
        'Brake Inspection',
        'Brake Pad Replacement',
        'Brake Fluid Change',
        'Coolant Flush',
        'Transmission Fluid Change',
        'Power Steering Fluid Check',
        'Battery Check',
        'Spark Plug Replacement',
        'Timing Belt Replacement',
        'Serpentine Belt Replacement',
        'Wiper Blade Replacement',
        'Headlight Alignment',
        'Wheel Alignment',
        'Wheel Balancing'
    ],
    [MaintenanceType.CORRECTIVE]: [
        'Engine Repair',
        'Engine Overhaul',
        'Cylinder Head Repair',
        'Piston Replacement',
        'Valve Adjustment',
        'Timing Chain Replacement',
        'Transmission Repair',
        'Transmission Rebuild',
        'Clutch Replacement',
        'Gearbox Repair',
        'Differential Repair',
        'Suspension Repair',
        'Shock Absorber Replacement',
        'Strut Replacement',
        'Control Arm Replacement',
        'Ball Joint Replacement',
        'Tie Rod Replacement',
        'Brake System Repair',
        'Brake Caliper Replacement',
        'Brake Rotor Replacement',
        'ABS System Repair',
        'Electrical System Repair',
        'Alternator Replacement',
        'Starter Motor Replacement',
        'Battery Replacement',
        'Wiring Harness Repair',
        'Fuel Pump Replacement',
        'Fuel Injector Cleaning',
        'Radiator Repair',
        'Water Pump Replacement',
        'Thermostat Replacement',
        'AC Compressor Replacement',
        'AC Condenser Replacement',
        'Heater Core Replacement',
        'Exhaust System Repair',
        'Muffler Replacement',
        'Catalytic Converter Replacement',
        'Body Work',
        'Dent Removal',
        'Paint Touch-up',
        'Bumper Replacement',
        'Windshield Replacement',
        'Door Panel Replacement',
        'Upholstery Repair'
    ],
    [MaintenanceType.EMERGENCY]: [
        'Breakdown Assistance',
        'Towing Service',
        'Flat Tire Repair',
        'Tire Replacement',
        'Battery Jump Start',
        'Battery Replacement',
        'Fuel Delivery',
        'Lockout Service',
        'Accident Recovery',
        'Engine Overheating',
        'Coolant Leak Repair',
        'Oil Leak Repair',
        'Brake Failure Repair',
        'Steering Failure Repair',
        'Electrical Failure Repair'
    ],
    [MaintenanceType.INSPECTION]: [
        'Annual Inspection',
        'Pre-Purchase Inspection',
        'Safety Inspection',
        'Emissions Test',
        'Brake System Inspection',
        'Suspension Inspection',
        'Tire Inspection',
        'Exhaust System Inspection',
        'Electrical System Inspection',
        'Engine Diagnostic',
        'Transmission Diagnostic',
        'AC System Inspection',
        'Fluid Level Check',
        'Belt and Hose Inspection'
    ]
};



export default function CreateRequestPage() {
    const router = useRouter();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [garages, setGarages] = useState<Garage[]>([]);
    const [drivers, setDrivers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        vehicleId: '',
        vehicleType: '',
        driverId: '',
        odometer: '',
        garageId: '',
        candidateGarageIds: [] as string[],
        maintenanceType: '',
        priority: '',
        startDate: new Date().toISOString().split('T')[0],
        expectedEndDate: '',
        maintenanceJobs: [] as string[],
        workOrderNo: '',
        description: '',
    });

    useEffect(() => {
        const loadData = async () => {
            const [v, g, d] = await Promise.all([getVehicles(), getGarages(), getDrivers()]);
            setVehicles(v);
            setGarages(g);
            setDrivers(d);
        };
        loadData();
    }, []);

    // Search States
    const [jobSearch, setJobSearch] = useState('');
    const [garageSearch, setGarageSearch] = useState('');

    // Attachments State
    const [attachments, setAttachments] = useState<{ type: string; file: File | null }[]>([
        { type: AttachmentType.INVOICE, file: null }
    ]);

    // Handle Vehicle Selection & Auto-populate Type
    const handleVehicleChange = (vehicleId: string) => {
        const vehicle = vehicles.find(v => v.id === vehicleId);
        setFormData(prev => ({
            ...prev,
            vehicleId,
            vehicleType: vehicle?.type || '',
        }));
    };

    // Handle Maintenance Type Selection & Auto-populate Priority
    const handleMaintenanceTypeChange = (type: string) => {
        let priority = MaintenancePriority.LOW;
        if (type === MaintenanceType.EMERGENCY) priority = MaintenancePriority.CRITICAL;
        if (type === MaintenanceType.CORRECTIVE) priority = MaintenancePriority.HIGH;
        if (type === MaintenanceType.PREVENTIVE) priority = MaintenancePriority.MEDIUM;

        setFormData(prev => ({
            ...prev,
            maintenanceType: type,
            priority,
            maintenanceJobs: [],
            candidateGarageIds: [] // Reset garages when type changes
        }));
        setJobSearch(''); // Reset search
    };

    // Get Maintenance Jobs based on Type
    const getMaintenanceJobs = (type: string): string[] => {
        return MAINTENANCE_JOBS_DATABASE[type as keyof typeof MAINTENANCE_JOBS_DATABASE] || [];
    };

    // Filter jobs based on search
    const getFilteredJobs = (): string[] => {
        const jobs = getMaintenanceJobs(formData.maintenanceType);
        if (!jobSearch.trim()) return jobs;
        return jobs.filter(job => job.toLowerCase().includes(jobSearch.toLowerCase()));
    };

    // Filter garages based on selected jobs
    const getFilteredGarages = (): Garage[] => {
        let filtered = garages;

        // Filter by selected maintenance jobs
        if (formData.maintenanceJobs.length > 0) {
            filtered = filtered.filter(garage => {
                const garageServices = garage.specialties || [];

                // Check if garage supports the entire maintenance type
                if (formData.maintenanceType && garageServices.includes(formData.maintenanceType)) {
                    return true;
                }

                // Check for specific job matches
                return formData.maintenanceJobs.some(job =>
                    garageServices.some(service =>
                        service.toLowerCase().includes(job.toLowerCase()) ||
                        job.toLowerCase().includes(service.toLowerCase())
                    )
                );
            });
        }

        // Filter by search query
        if (garageSearch.trim()) {
            filtered = filtered.filter(garage =>
                garage.name.toLowerCase().includes(garageSearch.toLowerCase()) ||
                garage.specialties.some(s => s.toLowerCase().includes(garageSearch.toLowerCase()))
            );
        }

        return filtered;
    };

    const handleJobToggle = (job: string) => {
        setFormData(prev => {
            const jobs = prev.maintenanceJobs.includes(job)
                ? prev.maintenanceJobs.filter(j => j !== job)
                : [...prev.maintenanceJobs, job];
            return { ...prev, maintenanceJobs: jobs };
        });
    };

    const handleGarageToggle = (garageId: string) => {
        setFormData(prev => {
            const ids = prev.candidateGarageIds.includes(garageId)
                ? prev.candidateGarageIds.filter(id => id !== garageId)
                : [...prev.candidateGarageIds, garageId];
            return { ...prev, candidateGarageIds: ids };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            // Prepare attachments
            const processedAttachments = attachments
                .filter(a => a.file)
                .map(a => ({
                    id: crypto.randomUUID(), // Generate a temporary ID
                    type: a.type as AttachmentType,
                    fileName: a.file?.name || 'unknown',
                    url: `mock://${a.file?.name}`, // Mock URL
                    uploadedAt: new Date().toISOString()
                }));

            const requestData = {
                vehicleId: formData.vehicleId,
                driverId: formData.driverId || drivers[0]?.id,
                requestDate: formData.startDate,
                description: formData.description,
                garageId: formData.candidateGarageIds[0] || garages[0].id,
                estimatedCost: 0,
                // Add missing fields
                odometer: parseInt(formData.odometer) || 0,
                maintenanceType: formData.maintenanceType as MaintenanceType,
                priority: formData.priority as MaintenancePriority,
                maintenanceJobs: formData.maintenanceJobs,
                candidateGarageIds: formData.candidateGarageIds,
                workOrderNo: formData.workOrderNo,
                expectedEndDate: formData.expectedEndDate,
                attachments: processedAttachments,
            };

            await createMaintenanceRequest(requestData);
            alert('Maintenance request created successfully!');
            router.push('/maintenance/requests');
        } catch (error) {
            console.error(error);
            alert('Failed to create maintenance request');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Create Maintenance Request</h1>
                <p className="mt-1 text-slate-500">Submit a new maintenance request for your vehicle</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 rounded-xl border border-white/10 bg-slate-900 p-8 shadow-sm">
                {/* Section 1: Vehicle Information */}
                <div>
                    <h3 className="mb-4 text-lg font-semibold text-white">Vehicle Information</h3>
                    <div className="grid gap-6 md:grid-cols-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Vehicle ID *</label>
                            <select
                                required
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.vehicleId}
                                onChange={(e) => handleVehicleChange(e.target.value)}
                            >
                                <option value="" className="text-white bg-slate-900">Select Vehicle</option>
                                {vehicles.map((v) => (
                                    <option key={v.id} value={v.id} className="text-white bg-slate-900">{v.licensePlate} - {v.make} {v.model}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Vehicle Type</label>
                            <input
                                type="text"
                                disabled
                                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-800/50 px-3 py-2 text-white shadow-sm"
                                value={formData.vehicleType}
                                placeholder="Auto-populated"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Odometer (km) *</label>
                            <input
                                type="number"
                                required
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.odometer}
                                onChange={(e) => setFormData({ ...formData, odometer: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                <hr className="border-white/10" />

                {/* Section 2: Maintenance Details */}
                <div>
                    <h3 className="mb-4 text-lg font-semibold text-white">Maintenance Details</h3>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Maintenance Type *</label>
                            <select
                                required
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.maintenanceType}
                                onChange={(e) => handleMaintenanceTypeChange(e.target.value)}
                            >
                                <option value="" className="text-white bg-slate-900">Select Type</option>
                                {Object.values(MaintenanceType).map((t) => (
                                    <option key={t} value={t} className="text-white bg-slate-900">{t}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Priority</label>
                            <input
                                type="text"
                                disabled
                                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-800/50 px-3 py-2 text-white shadow-sm"
                                value={formData.priority}
                                placeholder="Auto-populated"
                            />
                        </div>
                    </div>

                    {/* Maintenance Jobs - Moved here and enhanced */}
                    {formData.maintenanceType && (
                        <div className="mt-6">
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Maintenance Jobs *
                                <span className="ml-2 text-xs text-slate-500">({getMaintenanceJobs(formData.maintenanceType).length} available)</span>
                            </label>

                            {/* Search Box */}
                            <div className="mb-3">
                                <input
                                    type="text"
                                    placeholder="Search maintenance jobs..."
                                    value={jobSearch}
                                    onChange={(e) => setJobSearch(e.target.value)}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                />
                            </div>

                            {/* Jobs Grid with Scroll */}
                            <div className="max-h-60 overflow-y-auto rounded-lg border border-white/15 p-3 bg-slate-800/50">
                                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                                    {getFilteredJobs().map((job) => (
                                        <label key={job} className="flex items-center space-x-2 rounded-lg border border-white/10 bg-slate-900 p-2 hover:bg-blue-500/10 cursor-pointer transition-colors">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                                checked={formData.maintenanceJobs.includes(job)}
                                                onChange={() => handleJobToggle(job)}
                                            />
                                            <span className="text-xs text-slate-300">{job}</span>
                                        </label>
                                    ))}
                                </div>
                                {getFilteredJobs().length === 0 && (
                                    <p className="text-center text-sm text-slate-500 py-4">No jobs found matching "{jobSearch}"</p>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Selected: {formData.maintenanceJobs.length} job(s)
                            </p>
                        </div>
                    )}

                    {/* Candidate Garages - Enhanced with filtering */}
                    {formData.maintenanceJobs.length > 0 && (
                        <div className="mt-6">
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Candidate Garages (for RFQ)
                                <span className="ml-2 text-xs text-slate-500">({getFilteredGarages().length} matching)</span>
                            </label>

                            {/* Search Box */}
                            <div className="mb-3">
                                <input
                                    type="text"
                                    placeholder="Search garages..."
                                    value={garageSearch}
                                    onChange={(e) => setGarageSearch(e.target.value)}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                />
                            </div>

                            {/* Garages List */}
                            <div className="max-h-48 overflow-y-auto rounded-lg border border-white/15 p-2 bg-slate-900">
                                {getFilteredGarages().map((g) => (
                                    <label key={g.id} className="flex items-start space-x-3 p-3 hover:bg-white/5 rounded cursor-pointer border-b border-white/5 last:border-0">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mt-0.5 rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                            checked={formData.candidateGarageIds.includes(g.id)}
                                            onChange={() => handleGarageToggle(g.id)}
                                        />
                                        <div className="flex-1">
                                            <span className="font-medium text-white text-sm block">{g.name}</span>
                                            <span className="text-slate-500 text-xs block mt-0.5">{g.location}</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {(g.specialties || []).map((spec, idx) => (
                                                    <span key={idx} className="inline-flex items-center rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-700">
                                                        {spec}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                                {getFilteredGarages().length === 0 && (
                                    <p className="text-center text-sm text-slate-500 py-4">No garages found matching your criteria</p>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                                Select multiple garages to request quotations. Selected: {formData.candidateGarageIds.length}
                            </p>
                        </div>
                    )}

                    <div className="mt-6">
                        <label className="block text-sm font-medium text-slate-300">Work Order No.</label>
                        <input
                            type="text"
                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                            value={formData.workOrderNo}
                            onChange={(e) => setFormData({ ...formData, workOrderNo: e.target.value })}
                        />
                    </div>
                </div>

                <hr className="border-white/10" />

                {/* Section 3: Schedule & Driver */}
                <div>
                    <h3 className="mb-4 text-lg font-semibold text-white">Schedule & Assignment</h3>
                    <div className="grid gap-6 md:grid-cols-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Start Date *</label>
                            <input
                                type="date"
                                required
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.startDate}
                                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Expected End Date</label>
                            <input
                                type="date"
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.expectedEndDate}
                                onChange={(e) => setFormData({ ...formData, expectedEndDate: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300">Driver</label>
                            <select
                                className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                value={formData.driverId}
                                onChange={(e) => setFormData({ ...formData, driverId: e.target.value })}
                            >
                                <option value="">Select Driver</option>
                                {drivers.map((d) => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <hr className="border-white/10" />

                {/* Section 4: Additional Details */}
                <div>
                    <h3 className="mb-4 text-lg font-semibold text-white">Additional Details</h3>
                    <div>
                        <label className="block text-sm font-medium text-slate-300">Description / Remarks</label>
                        <textarea
                            rows={4}
                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Describe the issue or maintenance requirements..."
                        />
                    </div>
                </div>

                <hr className="border-white/10" />

                {/* Section 5: Attachments */}
                <div>
                    <h3 className="mb-4 text-lg font-semibold text-white">Attachments</h3>
                    <div className="space-y-4">
                        {attachments.map((att, index) => (
                            <div key={index} className="flex items-end gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-slate-300">Type</label>
                                    <select
                                        className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                        value={att.type}
                                        onChange={(e) => {
                                            const newAtts = [...attachments];
                                            newAtts[index].type = e.target.value;
                                            setAttachments(newAtts);
                                        }}
                                    >
                                        {Object.values(AttachmentType).map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex-[2]">
                                    <label className="block text-sm font-medium text-slate-300">File</label>
                                    <input
                                        type="file"
                                        className="mt-1 block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/10 file:text-blue-700 hover:file:bg-blue-500/20"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0] || null;
                                            const newAtts = [...attachments];
                                            newAtts[index].file = file;
                                            setAttachments(newAtts);
                                        }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const newAtts = attachments.filter((_, i) => i !== index);
                                        setAttachments(newAtts);
                                    }}
                                    className="mb-1 p-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                                    disabled={attachments.length === 1}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setAttachments([...attachments, { type: AttachmentType.IMAGE, file: null }])}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Add Another Attachment
                        </button>
                    </div>
                </div>

                <hr className="border-white/10" />

                {/* Submit Buttons */}
                <div className="flex justify-end gap-3 pt-6 border-t border-white/10">
                    <button
                        type="button"
                        onClick={() => router.back()}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                    >
                        {submitting ? 'Creating...' : 'Create Request'}
                    </button>
                </div>
            </form>
        </div>
    );
}
