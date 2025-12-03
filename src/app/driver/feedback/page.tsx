'use client';

import { useState } from 'react';
import {
    DriverFeedback,
    Vehicle,
    MaintenanceRequest
} from '@/types/maintenance';

export default function DriverFeedbackPage() {
    const [feedbackList, setFeedbackList] = useState<DriverFeedback[]>([]);
    const [showReportModal, setShowReportModal] = useState(false);
    const [formData, setFormData] = useState({
        vehicleId: '',
        issueReported: '',
        severity: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
        category: 'Engine',
        photos: [] as string[]
    });

    const handleSubmitFeedback = () => {
        const newFeedback: DriverFeedback = {
            id: `fb-${Date.now()}`,
            requestId: `req-${Date.now()}`,
            driverId: 'driver-1',
            vehicleId: formData.vehicleId,
            submittedDate: new Date().toISOString(),
            issueReported: formData.issueReported,
            severity: formData.severity,
            category: formData.category,
            photos: formData.photos
        };

        setFeedbackList([newFeedback, ...feedbackList]);
        setShowReportModal(false);
        setFormData({
            vehicleId: '',
            issueReported: '',
            severity: 'Medium',
            category: 'Engine',
            photos: []
        });
        alert('Issue reported successfully! A maintenance request will be created.');
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'Low': return 'bg-blue-100 text-blue-700 border-blue-300';
            case 'Medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'High': return 'bg-orange-100 text-orange-700 border-orange-300';
            case 'Critical': return 'bg-red-100 text-red-700 border-red-300';
            default: return 'bg-slate-100 text-slate-700 border-slate-300';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Driver Feedback</h1>
                    <p className="mt-1 text-slate-500">Report issues and provide feedback on repairs</p>
                </div>
                <button
                    onClick={() => setShowReportModal(true)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    + Report Issue
                </button>
            </div>

            {/* Feedback List */}
            <div className="grid grid-cols-1 gap-4">
                {feedbackList.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
                        <p className="text-slate-500">No feedback submitted yet.</p>
                        <button
                            onClick={() => setShowReportModal(true)}
                            className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                            Report your first issue
                        </button>
                    </div>
                ) : (
                    feedbackList.map(feedback => (
                        <div key={feedback.id} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">{feedback.issueReported}</h3>
                                    <p className="text-sm text-slate-500 mt-1">
                                        {new Date(feedback.submittedDate).toLocaleString()} • {feedback.category}
                                    </p>
                                </div>
                                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${getSeverityColor(feedback.severity)}`}>
                                    {feedback.severity}
                                </span>
                            </div>
                            {feedback.satisfactionRating && (
                                <div className="mt-4 pt-4 border-t border-slate-200">
                                    <p className="text-sm text-slate-600">Repair Satisfaction: {feedback.satisfactionRating}/5 ⭐</p>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Report Modal */}
            {showReportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">Report Issue</h3>
                                <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Vehicle ID</label>
                                <input
                                    type="text"
                                    value={formData.vehicleId}
                                    onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="e.g., v1"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Issue Description *</label>
                                <textarea
                                    rows={4}
                                    value={formData.issueReported}
                                    onChange={(e) => setFormData({ ...formData, issueReported: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="Describe the issue you're experiencing..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Severity</label>
                                    <select
                                        value={formData.severity}
                                        onChange={(e) => setFormData({ ...formData, severity: e.target.value as any })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    >
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Category</label>
                                    <select
                                        value={formData.category}
                                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    >
                                        <option value="Engine">Engine</option>
                                        <option value="Brakes">Brakes</option>
                                        <option value="Transmission">Transmission</option>
                                        <option value="Electrical">Electrical</option>
                                        <option value="AC">AC/Heating</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowReportModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmitFeedback}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Submit Report
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
