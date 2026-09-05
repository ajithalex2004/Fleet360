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
            <div className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 border border-[var(--border-subtle)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
                    <h3 className="text-lg font-bold text-[var(--text-main)]">{title}</h3>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Alert Details Section */}
                    <div className="bg-[var(--bg-surface)]/50 rounded-lg p-4 space-y-3 border border-[var(--border-subtle)]">
                        <h4 className="font-semibold text-[var(--text-main)] text-sm">Alert Details</h4>

                        <div className="grid grid-cols-2 gap-y-2 text-sm">
                            <div className="text-[var(--text-muted)]">Title:</div>
                            <div className="text-right font-medium text-[var(--text-main)]">{request.serviceType}</div>

                            <div className="text-[var(--text-muted)]">Type:</div>
                            <div className="text-right text-[var(--text-muted)]">{request.serviceType}</div>

                            <div className="text-[var(--text-muted)]">Severity:</div>
                            <div className="text-right">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${request.priority === 'High' ? 'bg-red-500/20 text-red-300' :
                                        request.priority === 'Medium' ? 'bg-amber-500/20 text-amber-300' :
                                            'bg-emerald-500/20 text-emerald-300'
                                    }`}>
                                    {request.priority}
                                </span>
                            </div>

                            <div className="text-[var(--text-muted)]">Created:</div>
                            <div className="text-right text-[var(--text-muted)]">{request.date}</div>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)]">
                            <div className="text-[var(--text-muted)] text-xs mb-1">Description:</div>
                            <p className="text-sm text-[var(--text-muted)]">{request.description}</p>
                        </div>
                    </div>

                    {/* Input Section */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">
                                Assign To (Email) <span className="text-red-400">*</span>
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter email address"
                                className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            />
                            <p className="mt-1 text-xs text-[var(--text-faint)]">
                                The alert will be assigned to this person and they will receive a notification.
                            </p>
                        </div>

                        {/* Footer Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors"
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
