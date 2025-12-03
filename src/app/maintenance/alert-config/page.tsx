'use client';

import { useState } from 'react';
import { mockVehicles, mockDrivers, mockSchedules } from '@/services/mockData';

interface AlertConfig {
    id: string;
    alertFor: 'Vehicle' | 'Driver';
    alertType: string;
    frequency: 'By Odometer' | 'By Date' | 'By Time';
    frequencyValue: number;
    dueAlertThreshold: string;
    thresholdValue: number;
    notificationEnabled: boolean;
    whatsappEnabled?: boolean;
    assignedIds: string[];
}

interface EmailLog {
    id: string;
    timestamp: string;
    recipient: string;
    subject: string;
    body: string;
    triggerReason: string;
    type?: 'Email' | 'WhatsApp';
    whatsappLink?: string;
}

const initialConfigs: AlertConfig[] = [
    {
        id: '1',
        alertFor: 'Vehicle',
        alertType: 'Maintenance Service',
        frequency: 'By Odometer',
        frequencyValue: 5000,
        dueAlertThreshold: 'Odometer Before',
        thresholdValue: 500,
        notificationEnabled: true,
        whatsappEnabled: true,
        assignedIds: ['v1', 'v2'],
    },
    {
        id: '2',
        alertFor: 'Driver',
        alertType: 'License Renewal',
        frequency: 'By Date',
        frequencyValue: 365,
        dueAlertThreshold: 'Days Before',
        thresholdValue: 30,
        notificationEnabled: true,
        assignedIds: ['d1'],
    },
];

export default function AlertConfigPage() {
    const [configs, setConfigs] = useState<AlertConfig[]>(initialConfigs);
    const [currentConfig, setCurrentConfig] = useState<AlertConfig>(initialConfigs[0]);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [notificationLog, setNotificationLog] = useState<EmailLog[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<EmailLog | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const alertTypes = {
        Vehicle: ['Maintenance Service', 'Registration Renewal', 'Insurance Renewal', 'Permit Renewal'],
        Driver: ['License Renewal', 'Medical Certificate', 'Training Due'],
    };

    const frequencyOptions = ['By Odometer', 'By Date', 'By Time'];

    const thresholdOptions = {
        'By Odometer': ['Odometer Before', 'Odometer After'],
        'By Date': ['Days Before', 'Days After'],
        'By Time': ['Hours Before', 'Hours After'],
    };

    const handleSave = () => {
        if (isAddingNew) {
            setConfigs([...configs, { ...currentConfig, id: Date.now().toString() }]);
            setIsAddingNew(false);
        } else {
            setConfigs(configs.map(c => c.id === currentConfig.id ? currentConfig : c));
        }
    };

    const handleReset = () => {
        setCurrentConfig(initialConfigs[0]);
        setIsAddingNew(false);
        setSearchTerm('');
    };

    const handleAddNew = () => {
        setIsAddingNew(true);
        setSearchTerm('');
        setCurrentConfig({
            id: '',
            alertFor: 'Vehicle',
            alertType: 'Maintenance Service',
            frequency: 'By Odometer',
            frequencyValue: 5000,
            dueAlertThreshold: 'Odometer Before',
            thresholdValue: 500,
            notificationEnabled: true,
            whatsappEnabled: false,
            assignedIds: [],
        });
    };

    const toggleAssignment = (id: string) => {
        const newAssignedIds = currentConfig.assignedIds.includes(id)
            ? currentConfig.assignedIds.filter(assignedId => assignedId !== id)
            : [...currentConfig.assignedIds, id];
        setCurrentConfig({ ...currentConfig, assignedIds: newAssignedIds });
    };

    const getFilteredItems = () => {
        const items = currentConfig.alertFor === 'Vehicle' ? mockVehicles : mockDrivers;
        if (!searchTerm) return items;

        const lowerTerm = searchTerm.toLowerCase();
        return items.filter(item => {
            if (currentConfig.alertFor === 'Vehicle') {
                const v = item as any;
                return v.make.toLowerCase().includes(lowerTerm) ||
                    v.model.toLowerCase().includes(lowerTerm) ||
                    v.licensePlate.toLowerCase().includes(lowerTerm);
            } else {
                const d = item as any;
                return d.name.toLowerCase().includes(lowerTerm) ||
                    d.licenseNumber.toLowerCase().includes(lowerTerm);
            }
        });
    };

    const filteredItems = getFilteredItems();

    const selectAllFiltered = () => {
        const newIds = new Set(currentConfig.assignedIds);
        filteredItems.forEach(item => newIds.add(item.id));
        setCurrentConfig({ ...currentConfig, assignedIds: Array.from(newIds) });
    };

    const clearSelection = () => {
        setCurrentConfig({ ...currentConfig, assignedIds: [] });
    };

    const getUnit = (frequency: string) => {
        switch (frequency) {
            case 'By Odometer': return 'KM';
            case 'By Date': return 'Days';
            case 'By Time': return 'Hours';
            default: return '';
        }
    };

    const generateEmailTemplate = (vehicle: any, schedule: any, mileageDiff: number, isOverdue: boolean) => {
        const status = isOverdue ? 'OVERDUE' : 'DUE SOON';
        const color = isOverdue ? '#ef4444' : '#f59e0b'; // Red or Amber

        return `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #1e293b; padding: 20px; text-align: center;">
                    <h2 style="color: #fff; margin: 0;">Maintenance Alert</h2>
                </div>
                <div style="padding: 24px;">
                    <p style="font-size: 16px; margin-bottom: 20px;">Hello Fleet Manager,</p>
                    <p style="font-size: 16px; margin-bottom: 20px;">
                        This is an automated notification regarding the maintenance status of vehicle 
                        <strong>${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})</strong>.
                    </p>
                    
                    <div style="background-color: ${isOverdue ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${color}; padding: 16px; margin-bottom: 24px;">
                        <h3 style="color: ${color}; margin-top: 0; margin-bottom: 8px;">Status: ${status}</h3>
                        <p style="margin: 0;">
                            ${isOverdue
                ? `Maintenance is overdue by <strong>${Math.abs(mileageDiff)} km</strong>.`
                : `Maintenance is due in <strong>${mileageDiff} km</strong>.`}
                        </p>
                    </div>

                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 12px 0; color: #6b7280;">Current Odometer</td>
                            <td style="padding: 12px 0; font-weight: bold; text-align: right;">${vehicle.currentMileage.toLocaleString()} km</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 12px 0; color: #6b7280;">Next Service Due</td>
                            <td style="padding: 12px 0; font-weight: bold; text-align: right;">${schedule.nextServiceMileage.toLocaleString()} km</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px 0; color: #6b7280;">Service Type</td>
                            <td style="padding: 12px 0; font-weight: bold; text-align: right;">${schedule.serviceType}</td>
                        </tr>
                    </table>

                    <p style="font-size: 14px; color: #6b7280; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                        Please schedule a maintenance request for this vehicle as soon as possible to ensure fleet compliance and safety.
                    </p>
                    <div style="text-align: center; margin-top: 24px;">
                        <a href="#" style="background-color: #2563eb; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Create Maintenance Request</a>
                    </div>
                </div>
                <div style="background-color: #f9fafb; padding: 16px; text-align: center; font-size: 12px; color: #9ca3af;">
                    &copy; 2025 Future Fleet Management System. All rights reserved.
                </div>
            </div>
        `;
    };

    const checkAlerts = () => {
        const logs: EmailLog[] = [];
        const timestamp = new Date().toLocaleTimeString();

        configs.forEach(config => {
            if (!config.notificationEnabled) return;

            if (config.alertType === 'Maintenance Service' && config.alertFor === 'Vehicle') {
                config.assignedIds.forEach(vehicleId => {
                    const vehicle = mockVehicles.find(v => v.id === vehicleId);
                    const schedule = mockSchedules.find(s => s.vehicleId === vehicleId);

                    if (vehicle && schedule) {
                        const mileageDiff = schedule.nextServiceMileage - vehicle.currentMileage;
                        let isTriggered = false;
                        let isOverdue = false;

                        if (mileageDiff <= config.thresholdValue && mileageDiff > 0) {
                            isTriggered = true;
                        } else if (mileageDiff <= 0) {
                            isTriggered = true;
                            isOverdue = true;

                            if (logs.length > 0) {
                                setNotificationLog(prev => [...logs, ...prev]);
                                alert(`Triggered ${logs.length} email notifications. Check the log below.`);
                            } else {
                                alert('No alerts triggered based on current configurations and vehicle status.');
                            }
                        }
                    }
                });
            }
        });

        if (logs.length > 0) {
            setNotificationLog(prev => [...logs, ...prev]);
            alert(`Triggered ${logs.length} email notifications. Check the log below.`);
        } else {
            alert('No alerts triggered based on current configurations and vehicle status.');
        }
    };

    return (
        <div className="space-y-8 relative">
            {/* Email Modal */}
            {selectedEmail && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedEmail(null)}>
                    <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Email Preview</h3>
                                <p className="text-xs text-slate-500">Sent to: {selectedEmail.recipient} at {selectedEmail.timestamp}</p>
                            </div>
                            <button onClick={() => setSelectedEmail(null)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-4 border-b border-slate-100">
                            <span className="text-sm font-bold text-slate-700">Subject: </span>
                            <span className="text-sm text-slate-900">{selectedEmail.subject}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
                            <div dangerouslySetInnerHTML={{ __html: selectedEmail.body }} />
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-white flex justify-end">
                            <button onClick={() => setSelectedEmail(null)} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium text-sm">
                                Close Preview
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Alert Configuration</h1>
                    <p className="mt-1 text-slate-500">Configure automated alerts and notifications.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={checkAlerts}
                        className="rounded-xl bg-green-50 border border-green-200 px-6 py-2.5 text-sm font-medium text-green-700 shadow-sm transition-all hover:bg-green-100 hover:scale-105"
                    >
                        Run Alert Check
                    </button>
                    <button
                        onClick={handleAddNew}
                        className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:scale-105"
                    >
                        + Add New Alert
                    </button>
                </div>
            </div>

            {/* Configuration Form */}
            <div className="bg-white rounded-2xl p-8 relative overflow-hidden border border-slate-200 shadow-sm">
                <div className="absolute top-0 right-0 p-6 opacity-5">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-32 h-32 text-slate-900">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                </div>

                <h2 className="mb-6 text-xl font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
                    {isAddingNew ? 'Create New Alert Rule' : 'Edit Alert Rule'}
                </h2>

                <div className="space-y-6 relative z-10">
                    {/* Alert For & Alert Type */}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Alert For</label>
                            <select
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                value={currentConfig.alertFor}
                                onChange={(e) => {
                                    const newAlertFor = e.target.value as 'Vehicle' | 'Driver';
                                    setCurrentConfig({
                                        ...currentConfig,
                                        alertFor: newAlertFor,
                                        alertType: alertTypes[newAlertFor][0],
                                        assignedIds: [] // Reset assignments on type change
                                    });
                                }}
                            >
                                <option value="Vehicle" className="text-slate-900">Vehicle</option>
                                <option value="Driver" className="text-slate-900">Driver</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Alert / Notification Type</label>
                            <select
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                value={currentConfig.alertType}
                                onChange={(e) => setCurrentConfig({ ...currentConfig, alertType: e.target.value })}
                            >
                                {alertTypes[currentConfig.alertFor].map((type) => (
                                    <option key={type} value={type} className="text-slate-900">{type}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Frequency */}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Frequency</label>
                            <select
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                value={currentConfig.frequency}
                                onChange={(e) => setCurrentConfig({
                                    ...currentConfig,
                                    frequency: e.target.value as AlertConfig['frequency'],
                                    dueAlertThreshold: thresholdOptions[e.target.value as keyof typeof thresholdOptions][0]
                                })}
                            >
                                {frequencyOptions.map((option) => (
                                    <option key={option} value={option} className="text-slate-900">{option}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Frequency Value ({getUnit(currentConfig.frequency)})
                            </label>
                            <input
                                type="number"
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors placeholder-slate-400"
                                value={currentConfig.frequencyValue}
                                onChange={(e) => setCurrentConfig({ ...currentConfig, frequencyValue: Number(e.target.value) })}
                                placeholder={`Enter value in ${getUnit(currentConfig.frequency)}`}
                            />
                        </div>
                    </div>

                    {/* Due Alert Threshold */}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Due Alert Threshold</label>
                            <select
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                value={currentConfig.dueAlertThreshold}
                                onChange={(e) => setCurrentConfig({ ...currentConfig, dueAlertThreshold: e.target.value })}
                            >
                                {thresholdOptions[currentConfig.frequency as keyof typeof thresholdOptions].map((option) => (
                                    <option key={option} value={option} className="text-slate-900">{option}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Threshold Value ({getUnit(currentConfig.frequency)})
                            </label>
                            <input
                                type="number"
                                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors placeholder-slate-400"
                                value={currentConfig.thresholdValue}
                                onChange={(e) => setCurrentConfig({ ...currentConfig, thresholdValue: Number(e.target.value) })}
                                placeholder={`Enter value in ${getUnit(currentConfig.frequency)}`}
                            />
                        </div>
                    </div>

                    {/* Assignment Section */}
                    <div className="border-t border-slate-200 pt-6">
                        <div className="flex flex-col gap-4 mb-4">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-slate-700">
                                    Assign to {currentConfig.alertFor}s
                                </label>
                                <div className="space-x-2">
                                    <button onClick={selectAllFiltered} className="text-xs text-blue-600 hover:text-blue-800">
                                        Select All {searchTerm && 'Filtered'}
                                    </button>
                                    <span className="text-slate-300">|</span>
                                    <button onClick={clearSelection} className="text-xs text-slate-500 hover:text-slate-700">Clear Selection</button>
                                </div>
                            </div>

                            {/* Search Input */}
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                    </svg>
                                </div>
                                <input
                                    type="text"
                                    className="block w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors placeholder-slate-400"
                                    placeholder={`Search ${currentConfig.alertFor}s...`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-48 overflow-y-auto custom-scrollbar p-1">
                            {filteredItems.map(item => {
                                const isSelected = currentConfig.assignedIds.includes(item.id);
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => toggleAssignment(item.id)}
                                        className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${isSelected
                                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                            }`}
                                    >
                                        <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                                            }`}>
                                            {isSelected && (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">
                                                {currentConfig.alertFor === 'Vehicle'
                                                    ? `${(item as any).make} ${(item as any).model}`
                                                    : (item as any).name}
                                            </p>
                                            <p className="text-xs opacity-70">
                                                {currentConfig.alertFor === 'Vehicle'
                                                    ? (item as any).licensePlate
                                                    : (item as any).licenseNumber}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Notification Enabled Toggle */}
                    <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentConfig({ ...currentConfig, notificationEnabled: !currentConfig.notificationEnabled })}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${currentConfig.notificationEnabled ? 'bg-blue-600' : 'bg-slate-200'
                                }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${currentConfig.notificationEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                        <span className="text-sm font-medium text-slate-700">Enable Automated Notifications</span>
                    </div>

                    {/* WhatsApp Enabled Toggle */}
                    <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentConfig({ ...currentConfig, whatsappEnabled: !currentConfig.whatsappEnabled })}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 ${currentConfig.whatsappEnabled ? 'bg-green-600' : 'bg-slate-200'
                                }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${currentConfig.whatsappEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                        <span className="text-sm font-medium text-slate-700">Enable WhatsApp Alerts</span>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            Reset
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:scale-105"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                            Save Rule
                        </button>
                    </div>
                </div>
            </div>

            {/* Notification Log */}
            {notificationLog.length > 0 && (
                <div className="bg-green-50 rounded-xl p-6 border border-green-200">
                    <h3 className="text-lg font-bold text-green-900 mb-4 flex items-center gap-2">
                        <span className="w-1 h-6 bg-green-600 rounded-full"></span>
                        Notification Log
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                        {notificationLog.map((log) => (
                            <div
                                key={log.id}
                                onClick={() => {
                                    console.log('Clicked log:', log);
                                    setSelectedEmail(log);
                                }}
                                className="flex items-center justify-between text-sm text-green-800 border-b border-green-200 pb-2 last:border-0 cursor-pointer hover:bg-green-100 transition-colors rounded px-2 -mx-2"
                            >
                                <div className="font-mono">
                                    <span className="opacity-70">[{log.timestamp}]</span> {log.triggerReason}
                                </div>
                                <button
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all transform hover:scale-105"
                                >
                                    VIEW EMAIL
                                </button>
                                {log.type === 'WhatsApp' && log.whatsappLink && (
                                    <a
                                        href={log.whatsappLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="ml-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all transform hover:scale-105 flex items-center gap-1"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-message-circle"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
                                        SEND WHATSAPP
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Configured Alerts List */}
            <div>
                <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
                    Configured Alert Rules
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {configs.map((config) => (
                        <div
                            key={config.id}
                            onClick={() => {
                                setCurrentConfig(config);
                                setIsAddingNew(false);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className={`bg-white rounded-xl p-6 cursor-pointer group relative overflow-hidden transition-all duration-300 hover:shadow-md border ${currentConfig.id === config.id && !isAddingNew ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300'}`}
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-24 h-24 text-slate-900">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                                </svg>
                            </div>

                            <div className="relative z-10">
                                <div className="flex justify-between items-start mb-4">
                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${config.alertFor === 'Vehicle' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                                        {config.alertFor}
                                    </span>
                                    <div className={`h-2.5 w-2.5 rounded-full shadow-sm ${config.notificationEnabled ? 'bg-green-500' : 'bg-slate-400'}`} />
                                </div>

                                <h4 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">{config.alertType}</h4>

                                <div className="space-y-2 mt-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Frequency:</span>
                                        <span className="text-slate-700 font-medium">{config.frequencyValue} {getUnit(config.frequency)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Threshold:</span>
                                        <span className="text-slate-700 font-medium">{config.thresholdValue} {getUnit(config.frequency)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm border-t border-slate-100 pt-2 mt-2">
                                        <span className="text-slate-500">Assigned To:</span>
                                        <span className="text-blue-600 font-medium">
                                            {config.assignedIds.length} {config.alertFor}s
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
