'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { MaintenanceRequest, Vehicle, MaintenanceStatus, Garage, AttachmentType, Driver } from '@/types/maintenance';
import { getMaintenanceRequests, getVehicleById, updateMaintenanceRequest, getGarages, getDriverById } from '@/services/mockData';
import WorkflowStepper from '@/components/ui/WorkflowStepper';
import StatusBadge from '@/components/ui/StatusBadge';

export default function RequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const [request, setRequest] = useState<MaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [driver, setDriver] = useState<Driver | null>(null);
    const [garages, setGarages] = useState<Garage[]>([]);
    const [selectedGarages, setSelectedGarages] = useState<string[]>([]);
    const [garageSearchQuery, setGarageSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);

    // Attachment State
    const [selectedAttachmentType, setSelectedAttachmentType] = useState<AttachmentType>(AttachmentType.INVOICE);
    const [showAttachmentModal, setShowAttachmentModal] = useState(false);

    // Unwrap params using React.use()
    const resolvedParams = use(params);
    const id = resolvedParams.id;

    useEffect(() => {
        const fetchData = async () => {
            const [reqs, garageList] = await Promise.all([
                getMaintenanceRequests(),
                getGarages(),
            ]);
            const foundRequest = reqs.find((r) => r.id === id);

            if (foundRequest) {
                setRequest(foundRequest);
                const [veh, drv] = await Promise.all([
                    getVehicleById(foundRequest.vehicleId),
                    foundRequest.driverId ? getDriverById(foundRequest.driverId) : Promise.resolve(undefined)
                ]);
                setVehicle(veh || null);
                setDriver(drv || null);
                // Initialize selected garages from candidateGarageIds
                if (foundRequest.candidateGarageIds && foundRequest.candidateGarageIds.length > 0) {
                    setSelectedGarages(foundRequest.candidateGarageIds);
                }
            }
            setGarages(garageList);
            setLoading(false);
        };
        fetchData();
    }, [id]);

    const handleStatusUpdate = async (newStatus: MaintenanceStatus) => {
        if (!request) return;

        const updates: Partial<MaintenanceRequest> = { status: newStatus };

        // Save selected garages when moving to Under Estimation
        if (newStatus === MaintenanceStatus.UNDER_ESTIMATION && selectedGarages.length > 0) {
            updates.candidateGarageIds = selectedGarages;
        }

        try {
            const updated = await updateMaintenanceRequest(request.id, updates);
            setRequest(updated);
        } catch (error) {
            console.error('Failed to update status', error);
        }
    };

    if (loading) return <div className="p-8 text-center">Loading details...</div>;
    if (!request) return <div className="p-8 text-center text-red-500">Request not found</div>;

    const currentGarage = garages.find(g => g.id === request.garageId);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-white">Request #{request.id.toUpperCase()}</h1>
                        <StatusBadge status={request.status} />
                    </div>
                    <p className="mt-1 text-slate-500">Created on {new Date(request.requestDate).toLocaleDateString()}</p>
                </div>
                <button
                    onClick={() => router.back()}
                    className="text-sm font-medium text-slate-500 hover:text-white"
                >
                    ← Back to Requests
                </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-white">Workflow Progress</h2>
                <WorkflowStepper currentStatus={request.status} statusTimeline={request.statusTimeline} />
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <div className="md:col-span-2 space-y-6">
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                        <h2 className="mb-4 text-lg font-semibold text-white">Issue Details</h2>

                        {/* Request Meta Info */}
                        <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg bg-slate-800/50 p-4">
                            <div>
                                <p className="text-sm font-medium text-slate-500">Requested By</p>
                                <p className="font-medium text-white">{driver ? driver.name : 'Unknown'}</p>
                                {driver && <p className="text-xs text-slate-500">{driver.contactNumber}</p>}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-500">Requested On</p>
                                <p className="font-medium text-white">
                                    {new Date(request.requestDate).toLocaleDateString(undefined, {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {new Date(request.requestDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>

                        <p className="text-slate-300 mb-6">
                            <span className="block text-sm font-medium text-slate-500 mb-1">Description</span>
                            {request.description}
                        </p>

                        {request.estimatedCost && (
                            <div className="mt-6 rounded-lg bg-slate-800/50 p-4">
                                <p className="text-sm font-medium text-slate-500">Estimated Cost</p>
                                <p className="text-2xl font-bold text-white">${request.estimatedCost}</p>
                            </div>
                        )}

                        {/* Garage Assignment Display */}
                        {currentGarage && (
                            <div className="mt-6 rounded-lg bg-slate-800/50 p-4">
                                <p className="text-sm font-medium text-slate-500">Assigned Garage</p>
                                <p className="text-lg font-bold text-white">{currentGarage.name}</p>
                                <p className="text-sm text-slate-500">{currentGarage.location}</p>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons based on Status */}
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                        <h2 className="mb-4 text-lg font-semibold text-white">Actions</h2>
                        <div className="flex flex-col gap-4">
                            {request.status === MaintenanceStatus.UNDER_ESTIMATION && (
                                <div className="w-full">
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Select Garages for Estimation</label>

                                    {/* Search Input */}
                                    <div className="mb-3">
                                        <div className="relative">
                                            <input
                                                type="text"
                                                placeholder="Search garages by name or location..."
                                                value={garageSearchQuery}
                                                onChange={(e) => setGarageSearchQuery(e.target.value)}
                                                className="w-full rounded-lg border border-white/15 px-3 py-2 pl-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            />
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="absolute left-3 top-2.5 h-5 w-5 text-slate-400">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                            </svg>
                                        </div>
                                    </div>

                                    {/* Garage List */}
                                    <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-slate-800/50 p-2">
                                        {garages
                                            .filter(g =>
                                                g.name.toLowerCase().includes(garageSearchQuery.toLowerCase()) ||
                                                g.location.toLowerCase().includes(garageSearchQuery.toLowerCase()) ||
                                                g.specialties.some(s => s.toLowerCase().includes(garageSearchQuery.toLowerCase()))
                                            )
                                            .map(g => (
                                                <label
                                                    key={g.id}
                                                    className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-all border mb-2 ${selectedGarages.includes(g.id)
                                                        ? 'bg-blue-500/10 border-blue-200 shadow-sm'
                                                        : 'bg-slate-900 border-transparent hover:bg-slate-900/5 hover:border-white/10'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                                        checked={selectedGarages.includes(g.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedGarages([...selectedGarages, g.id]);
                                                            } else {
                                                                setSelectedGarages(selectedGarages.filter(id => id !== g.id));
                                                            }
                                                        }}
                                                    />
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-medium text-white">{g.name}</span>
                                                            {g.isInternal && (
                                                                <span className="text-xs bg-emerald-500/20 text-green-700 px-2 py-0.5 rounded-full">Internal</span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-slate-500 mt-0.5">{g.location}</p>
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {g.specialties.slice(0, 3).map(specialty => (
                                                                <span key={specialty} className="text-xs bg-slate-700/40 text-slate-600 px-1.5 py-0.5 rounded">
                                                                    {specialty}
                                                                </span>
                                                            ))}
                                                            {g.specialties.length > 3 && (
                                                                <span className="text-xs text-slate-400">+{g.specialties.length - 3} more</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        {garages.filter(g =>
                                            g.name.toLowerCase().includes(garageSearchQuery.toLowerCase()) ||
                                            g.location.toLowerCase().includes(garageSearchQuery.toLowerCase())
                                        ).length === 0 && (
                                                <div className="text-center py-8 text-slate-500">
                                                    <p className="text-sm">No garages found</p>
                                                    <p className="text-xs mt-1">Try a different search term</p>
                                                </div>
                                            )}
                                    </div>

                                    {/* Selected Count */}
                                    <div className="mt-2 flex items-center justify-between text-sm">
                                        <span className="text-slate-600">
                                            {selectedGarages.length} garage{selectedGarages.length !== 1 ? 's' : ''} selected
                                        </span>
                                        {selectedGarages.length > 0 && (
                                            <button
                                                onClick={() => setSelectedGarages([])}
                                                className="text-blue-600 hover:text-blue-700 font-medium"
                                            >
                                                Clear all
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 flex-wrap">
                                {request.status === MaintenanceStatus.SUBMITTED && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.PENDING_OPERATIONS_ACK)}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        Acknowledge
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.PENDING_OPERATIONS_ACK && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL)}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        Submit for Approval
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL && (
                                    <>
                                        <button
                                            onClick={() => handleStatusUpdate(MaintenanceStatus.UNDER_ESTIMATION)}
                                            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                        >
                                            Approve Request
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate(MaintenanceStatus.REJECTED_BY_MAINTENANCE)}
                                            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                                        >
                                            Reject
                                        </button>
                                    </>
                                )}
                                {request.status === MaintenanceStatus.UNDER_ESTIMATION && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.PENDING_ESTIMATION_APPROVAL)}
                                        disabled={selectedGarages.length === 0}
                                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Submit Estimate
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.ESTIMATION_APPROVED)}
                                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                    >
                                        Approve Estimate
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.ESTIMATION_APPROVED && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.UNDER_MAINTENANCE)}
                                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
                                    >
                                        Start Maintenance
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.UNDER_MAINTENANCE && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.MAINTENANCE_COMPLETED)}
                                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                    >
                                        Complete Job
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.MAINTENANCE_COMPLETED && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.PENDING_INVOICE)}
                                        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                                    >
                                        Request Invoice
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.PENDING_INVOICE && (
                                    <p className="text-sm text-orange-600 font-medium">Pending Invoice</p>
                                )}
                                {request.status === MaintenanceStatus.INVOICE_SUBMITTED && (
                                    <button
                                        onClick={() => handleStatusUpdate(MaintenanceStatus.CLOSED)}
                                        className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                                    >
                                        Close Request
                                    </button>
                                )}
                                {request.status === MaintenanceStatus.CLOSED && (
                                    <p className="text-sm text-gray-600 font-medium">Request Closed</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                        <h2 className="mb-4 text-lg font-semibold text-white">Vehicle Info</h2>
                        {vehicle ? (
                            <div className="space-y-3">
                                <div>
                                    <p className="text-sm text-slate-500">Vehicle</p>
                                    <p className="font-medium text-white">{vehicle.make} {vehicle.model}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">License Plate</p>
                                    <p className="font-medium text-white">{vehicle.licensePlate}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Mileage</p>
                                    <p className="font-medium text-white">{vehicle.currentMileage.toLocaleString()} km</p>
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">VIN</p>
                                    <p className="font-medium text-white">{vehicle.vin}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-slate-500">Loading vehicle info...</p>
                        )}
                    </div>



                    {/* Attachments Section */}
                    <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white">Attachments</h2>
                            <button
                                onClick={() => setShowAttachmentModal(true)}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                + Add Attachment
                            </button>
                        </div>

                        {request.attachments && request.attachments.length > 0 ? (
                            <div className="space-y-3">
                                {request.attachments.map((att) => (
                                    <div key={att.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-800/50 p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 text-blue-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">{att.fileName}</p>
                                                <p className="text-xs text-slate-500">{att.type} • {new Date(att.uploadedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <a href={att.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
                                            View
                                        </a>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-slate-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto h-12 w-12 text-slate-300 mb-2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                </svg>
                                <p className="text-sm">No attachments yet</p>
                                <p className="text-xs mt-1">Click &quot;Add Attachment&quot; to upload invoices or documents</p>
                            </div>
                        )}
                    </div>
                </div>
            </div >

            {/* Attachment Upload Modal */}
            {
                showAttachmentModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-xl bg-slate-900 p-6 shadow-2xl">
                            <h3 className="text-lg font-bold text-white">Add Attachment</h3>
                            <p className="mt-1 text-sm text-slate-500">Select the attachment type and upload a file</p>

                            <div className="mt-4 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Attachment Type</label>
                                    <select
                                        value={selectedAttachmentType}
                                        onChange={(e) => setSelectedAttachmentType(e.target.value as AttachmentType)}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-900 text-white"
                                    >
                                        {Object.values(AttachmentType).map((type) => (
                                            <option key={type} value={type} className="text-white">
                                                {type}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="rounded-lg border-2 border-dashed border-white/15 p-6 text-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto h-12 w-12 text-slate-400">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                    </svg>
                                    <p className="mt-2 text-sm text-slate-600">Click below to select a file</p>
                                    <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG, DOC, DOCX, XLS, XLSX</p>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setShowAttachmentModal(false);
                                        setSelectedAttachmentType(AttachmentType.INVOICE);
                                    }}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/10"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
                                        input.onchange = async (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file && request) {
                                                const newAttachment = {
                                                    id: `att${Date.now()}`,
                                                    type: selectedAttachmentType,
                                                    fileName: file.name,
                                                    url: URL.createObjectURL(file),
                                                    uploadedAt: new Date().toISOString(),
                                                };
                                                const updatedRequest = {
                                                    ...request,
                                                    attachments: [...(request.attachments || []), newAttachment],
                                                };
                                                setRequest(updatedRequest);
                                                setShowAttachmentModal(false);
                                            }
                                        };
                                        input.click();
                                    }}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    Select File
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
