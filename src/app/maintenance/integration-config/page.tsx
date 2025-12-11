'use client';

import React, { useState } from 'react';

export default function IntegrationsPage() {
    const [activeTab, setActiveTab] = useState<'Email' | 'SMS' | 'WhatsApp'>('Email');

    // Email State
    const [emailConfig, setEmailConfig] = useState({
        host: '',
        port: '',
        username: '',
        password: '',
        encryption: 'TLS',
        fromEmail: '',
        fromName: '',
    });

    // SMS State
    const [smsConfig, setSmsConfig] = useState({
        provider: 'Twilio',
        apiKey: '',
        apiSecret: '',
        senderId: '',
    });

    // WhatsApp State
    const [whatsappConfig, setWhatsappConfig] = useState({
        provider: 'Twilio',
        accountSid: '',
        authToken: '',
        fromNumber: '',
    });

    React.useEffect(() => {
        const fetchConfigs = async () => {
            try {
                const res = await fetch('/api/integration-configs');
                if (res.ok) {
                    const configs = await res.json();
                    configs.forEach((config: any) => {
                        if (config.type === 'EMAIL') {
                            setEmailConfig({
                                host: config.host || '',
                                port: config.port || '',
                                username: config.username || '',
                                password: config.password || '',
                                encryption: config.encryption || 'TLS',
                                fromEmail: config.senderEmail || '',
                                fromName: config.fromName || '',
                            });
                        } else if (config.type === 'SMS') {
                            setSmsConfig({
                                provider: config.provider || 'Twilio',
                                apiKey: config.apiKey || '',
                                apiSecret: config.apiSecret || '',
                                senderId: config.senderId || '',
                            });
                        } else if (config.type === 'WHATSAPP') {
                            setWhatsappConfig({
                                provider: config.provider || 'Twilio',
                                accountSid: config.accountSid || '',
                                authToken: config.authToken || '',
                                fromNumber: config.fromNumber || '',
                            });
                        }
                    });
                }
            } catch (error) {
                console.error('Failed to load configs:', error);
            }
        };
        fetchConfigs();
    }, []);

    const handleSave = async () => {
        try {
            // Save Email
            await fetch('/api/integration-configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'EMAIL',
                    provider: 'SMTP',
                    host: emailConfig.host,
                    port: emailConfig.port, // sent as string
                    username: emailConfig.username,
                    password: emailConfig.password,
                    encryption: emailConfig.encryption,
                    senderEmail: emailConfig.fromEmail,
                    fromName: emailConfig.fromName,
                }),
            });

            // Save SMS
            await fetch('/api/integration-configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'SMS',
                    provider: smsConfig.provider,
                    apiKey: smsConfig.apiKey,
                    apiSecret: smsConfig.apiSecret,
                    senderId: smsConfig.senderId,
                }),
            });

            // Save WhatsApp
            await fetch('/api/integration-configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'WHATSAPP',
                    provider: whatsappConfig.provider,
                    accountSid: whatsappConfig.accountSid,
                    authToken: whatsappConfig.authToken,
                    fromNumber: whatsappConfig.fromNumber,
                }),
            });

            alert('Configuration Saved Successfully!');
        } catch (error) {
            console.error('Failed to save configurations:', error);
            alert('Failed to save configuration. Please try again.');
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Integrations</h1>
                <p className="mt-1 text-slate-500">Configure external services for Email, SMS, and WhatsApp.</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {['Email', 'SMS', 'WhatsApp'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`
                                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                                ${activeTab === tab
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
                            `}
                        >
                            {tab} Integration
                        </button>
                    ))}
                </nav>
            </div>

            <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm max-w-4xl">

                {/* Email Configuration */}
                {activeTab === 'Email' && (
                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-slate-900">SMTP Configuration</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">SMTP Host</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="smtp.example.com"
                                    value={emailConfig.host}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, host: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Port</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="587"
                                    value={emailConfig.port}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, port: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Username</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={emailConfig.username}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, username: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
                                <input
                                    type="password"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={emailConfig.password}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, password: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Encryption</label>
                                <select
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={emailConfig.encryption}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, encryption: e.target.value })}
                                >
                                    <option value="TLS">TLS</option>
                                    <option value="SSL">SSL</option>
                                    <option value="None">None</option>
                                </select>
                            </div>
                        </div>
                        <div className="border-t border-slate-100 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">From Email</label>
                                <input
                                    type="email"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="notifications@example.com"
                                    value={emailConfig.fromEmail}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, fromEmail: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">From Name</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="System Notifications"
                                    value={emailConfig.fromName}
                                    onChange={(e) => setEmailConfig({ ...emailConfig, fromName: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* SMS Configuration */}
                {activeTab === 'SMS' && (
                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-slate-900">SMS Gateway Configuration</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Provider</label>
                                <select
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={smsConfig.provider}
                                    onChange={(e) => setSmsConfig({ ...smsConfig, provider: e.target.value })}
                                >
                                    <option value="Twilio">Twilio</option>
                                    <option value="MessageBird">MessageBird</option>
                                    <option value="ClickSend">ClickSend</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">API Key / SID</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={smsConfig.apiKey}
                                    onChange={(e) => setSmsConfig({ ...smsConfig, apiKey: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">API Secret / Auth Token</label>
                                <input
                                    type="password"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={smsConfig.apiSecret}
                                    onChange={(e) => setSmsConfig({ ...smsConfig, apiSecret: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Sender ID</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="e.g., MYAPP"
                                    value={smsConfig.senderId}
                                    onChange={(e) => setSmsConfig({ ...smsConfig, senderId: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* WhatsApp Configuration */}
                {activeTab === 'WhatsApp' && (
                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-slate-900">WhatsApp Configuration</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Provider</label>
                                <select
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={whatsappConfig.provider}
                                    onChange={(e) => setWhatsappConfig({ ...whatsappConfig, provider: e.target.value })}
                                >
                                    <option value="Twilio">Twilio</option>
                                    <option value="Meta">Meta Cloud API</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Account SID / App ID</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={whatsappConfig.accountSid}
                                    onChange={(e) => setWhatsappConfig({ ...whatsappConfig, accountSid: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Auth Token / Access Token</label>
                                <input
                                    type="password"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={whatsappConfig.authToken}
                                    onChange={(e) => setWhatsappConfig({ ...whatsappConfig, authToken: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">From Number</label>
                                <input
                                    type="text"
                                    className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="e.g., +14155238886"
                                    value={whatsappConfig.fromNumber}
                                    onChange={(e) => setWhatsappConfig({ ...whatsappConfig, fromNumber: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-8 pt-6 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:scale-105"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
}
