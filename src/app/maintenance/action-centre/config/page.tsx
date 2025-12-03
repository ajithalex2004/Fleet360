'use client';

import { useState } from 'react';

interface AlertConfig {
    id: string;
    alertFor: 'Vehicle' | 'Driver';
    alertType: string;
    frequency: 'By Odometer' | 'By Date' | 'By Time';
    frequencyValue: number;
    dueAlertThreshold: string;
    thresholdValue: number;
    notificationEnabled: boolean;
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
    },
];

export default function AlertConfigPage() {
    const [configs, setConfigs] = useState<AlertConfig[]>(initialConfigs);
    const [currentConfig, setCurrentConfig] = useState<AlertConfig>(initialConfigs[0]);
    const [isAddingNew, setIsAddingNew] = useState(false);

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
    };

    const handleAddNew = () => {
        setIsAddingNew(true);
        setCurrentConfig({
            id: '',
            alertFor: 'Vehicle',
            alertType: 'Maintenance Service',
            frequency: 'By Odometer',
            frequencyValue: 5000,
            dueAlertThreshold: 'Odometer Before',
            thresholdValue: 500,
            notificationEnabled: true,
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Alert Configuration</h1>
                    <p className="mt-1 text-slate-500">Configure automated alerts and notifications.</p>
                </div>
                <button
                    onClick={handleAddNew}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:shadow-blue-500/50"
                >
                    + Add Alert
                </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Saved Alerts List */}
                <div className="lg:col-span-1">
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-200 p-4">
                            <h3 className="font-semibold text-slate-900">Configured Alerts</h3>
                        </div>
                        <div className="divide-y divide-slate-200">
                            {configs.map((config) => (
                                <button
                                    key={config.id}
                                    onClick={() => {
                                        setCurrentConfig(config);
                                        setIsAddingNew(false);
                                    }}
                                    className={`w-full p-4 text-left transition-colors hover:bg-slate-50 ${currentConfig.id === config.id && !isAddingNew ? 'bg-blue-50' : ''
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">{config.alertType}</p>
                                            <p className="text-xs text-slate-500">{config.alertFor}</p>
                                        </div>
                                        <div className={`h-2 w-2 rounded-full ${config.notificationEnabled ? 'bg-green-500' : 'bg-slate-300'}`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Configuration Form */}
                <div className="lg:col-span-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="mb-6 text-lg font-bold text-slate-900">Configure Alert</h2>

                        <div className="space-y-6">
                            {/* Alert For & Alert Type */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Alert For</label>
                                    <select
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.alertFor}
                                        onChange={(e) => setCurrentConfig({
                                            ...currentConfig,
                                            alertFor: e.target.value as 'Vehicle' | 'Driver',
                                            alertType: alertTypes[e.target.value as 'Vehicle' | 'Driver'][0]
                                        })}
                                    >
                                        <option value="Vehicle" className="text-slate-900 bg-white">Vehicle</option>
                                        <option value="Driver" className="text-slate-900 bg-white">Driver</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Alert / Notification Type</label>
                                    <select
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.alertType}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, alertType: e.target.value })}
                                    >
                                        {alertTypes[currentConfig.alertFor].map((type) => (
                                            <option key={type} value={type} className="text-slate-900 bg-white">{type}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Frequency */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Frequency</label>
                                    <select
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.frequency}
                                        onChange={(e) => setCurrentConfig({
                                            ...currentConfig,
                                            frequency: e.target.value as AlertConfig['frequency'],
                                            dueAlertThreshold: thresholdOptions[e.target.value as keyof typeof thresholdOptions][0]
                                        })}
                                    >
                                        {frequencyOptions.map((option) => (
                                            <option key={option} value={option} className="text-slate-900 bg-white">{option}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Frequency Value (KM)</label>
                                    <input
                                        type="number"
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.frequencyValue}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, frequencyValue: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            {/* Due Alert Threshold */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Due Alert Threshold</label>
                                    <select
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.dueAlertThreshold}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, dueAlertThreshold: e.target.value })}
                                    >
                                        {thresholdOptions[currentConfig.frequency as keyof typeof thresholdOptions].map((option) => (
                                            <option key={option} value={option} className="text-slate-900 bg-white">{option}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Threshold Value (KM)</label>
                                    <input
                                        type="number"
                                        className="block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={currentConfig.thresholdValue}
                                        onChange={(e) => setCurrentConfig({ ...currentConfig, thresholdValue: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            {/* Notification Enabled Toggle */}
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={() => setCurrentConfig({ ...currentConfig, notificationEnabled: !currentConfig.notificationEnabled })}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${currentConfig.notificationEnabled ? 'bg-slate-900' : 'bg-slate-200'
                                        }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${currentConfig.notificationEnabled ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                                <span className="text-sm font-medium text-slate-700">Notification Enabled</span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
                                <button
                                    onClick={handleReset}
                                    className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                    </svg>
                                    Reset to Defaults
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                    </svg>
                                    Save Alert
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
