import React, { useState } from 'react';
import { ServiceRequest } from '@/types/maintenance';

interface AssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (email: string) => void;
    title: string;
    request: ServiceRequest;
    actionLabel: string;
}

export default function AssignmentModal({ isOpen, onClose, onConfirm, title, request, actionLabel }: AssignmentModalProps) {
    const [email, setEmail] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(email);
        setEmail(''); // Reset after submit
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Alert Details Section */}
                    <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-100">
                        <h4 className="font-semibold text-slate-900 text-sm">Alert Details</h4>

                        <div className="grid grid-cols-2 gap-y-2 text-sm">
                            <div className="text-slate-500">Title:</div>
                            <div className="text-right font-medium text-slate-900">{request.serviceType}</div>

                            <div className="text-slate-500">Type:</div>
                            <div className="text-right text-slate-700">{request.serviceType}</div>

                            <div className="text-slate-500">Severity:</div>
                            <div className="text-right">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${request.priority === 'High' ? 'bg-red-100 text-red-700' :
                                        request.priority === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                            'bg-green-100 text-green-700'
                                    }`}>
                                    {request.priority}
                                </span>
                            </div>

                            <div className="text-slate-500">Created:</div>
                            <div className="text-right text-slate-700">{request.date}</div>
                        </div>

                        <div className="pt-2 border-t border-slate-200">
                            <div className="text-slate-500 text-xs mb-1">Description:</div>
                            <p className="text-sm text-slate-700">{request.description}</p>
                        </div>
                    </div>

                    {/* Input Section */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Assign To (Email) <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter email address"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                                The alert will be assigned to this person and they will receive a notification.
                            </p>
                        </div>

                        {/* Footer Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
                            >
                                {actionLabel}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
