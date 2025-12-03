'use client';

import { useState } from 'react';

export default function PredictiveMaintenancePage() {
    const [predictions] = useState([
        {
            vehicleId: 'v1',
            vehicleName: 'Toyota Camry (ABC-123)',
            component: 'Brake Pads',
            currentCondition: 45,
            predictedFailureDate: '2025-01-15',
            confidence: 87,
            recommendedAction: 'Schedule replacement within 30 days',
            estimatedCost: 400,
            riskLevel: 'Medium'
        },
        {
            vehicleId: 'v2',
            vehicleName: 'Honda Accord (XYZ-456)',
            component: 'Battery',
            currentCondition: 32,
            predictedFailureDate: '2024-12-28',
            confidence: 92,
            recommendedAction: 'Immediate replacement recommended',
            estimatedCost: 200,
            riskLevel: 'High'
        },
        {
            vehicleId: 'v3',
            vehicleName: 'Ford F-150 (DEF-789)',
            component: 'Transmission Fluid',
            currentCondition: 68,
            predictedFailureDate: '2025-02-20',
            confidence: 78,
            recommendedAction: 'Monitor and schedule service',
            estimatedCost: 150,
            riskLevel: 'Low'
        }
    ]);

    const [costForecast] = useState({
        currentMonth: 4500,
        nextMonth: 5200,
        next3Months: 14800,
        next6Months: 28500,
        trend: 'increasing'
    });

    const getRiskColor = (risk: string) => {
        switch (risk) {
            case 'High': return 'bg-red-100 text-red-700 border-red-300';
            case 'Medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'Low': return 'bg-green-100 text-green-700 border-green-300';
            default: return 'bg-slate-100 text-slate-700 border-slate-300';
        }
    };

    const getConditionColor = (condition: number) => {
        if (condition >= 70) return 'bg-green-600';
        if (condition >= 40) return 'bg-yellow-600';
        return 'bg-red-600';
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Predictive Maintenance</h1>
                <p className="mt-1 text-slate-500">AI-powered failure prediction and cost forecasting</p>
            </div>

            {/* Cost Forecast */}
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Cost Forecast</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-slate-500">This Month</p>
                        <p className="text-2xl font-bold text-slate-900">${costForecast.currentMonth.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-slate-500">Next Month</p>
                        <p className="text-2xl font-bold text-blue-600">${costForecast.nextMonth.toLocaleString()}</p>
                        <p className="text-xs text-orange-600">↑ {Math.round(((costForecast.nextMonth - costForecast.currentMonth) / costForecast.currentMonth) * 100)}%</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-slate-500">Next 3 Months</p>
                        <p className="text-2xl font-bold text-slate-900">${costForecast.next3Months.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-slate-500">Next 6 Months</p>
                        <p className="text-2xl font-bold text-slate-900">${costForecast.next6Months.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* Failure Predictions */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="p-6 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-900">Predicted Failures</h3>
                    <p className="text-sm text-slate-500">Components likely to fail based on ML analysis</p>
                </div>
                <div className="divide-y divide-slate-200">
                    {predictions.map((pred, idx) => {
                        const daysUntil = Math.ceil((new Date(pred.predictedFailureDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

                        return (
                            <div key={idx} className="p-6 hover:bg-slate-50 transition-colors">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h4 className="text-base font-bold text-slate-900">{pred.vehicleName}</h4>
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getRiskColor(pred.riskLevel)}`}>
                                                {pred.riskLevel} Risk
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600">Component: <span className="font-medium text-slate-900">{pred.component}</span></p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-slate-500">Confidence</p>
                                        <p className="text-2xl font-bold text-blue-600">{pred.confidence}%</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Current Condition</p>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                <div
                                                    className={`h-2 rounded-full ${getConditionColor(pred.currentCondition)}`}
                                                    style={{ width: `${pred.currentCondition}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-medium text-slate-900">{pred.currentCondition}%</span>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Predicted Failure</p>
                                        <p className="text-sm font-medium text-slate-900">{new Date(pred.predictedFailureDate).toLocaleDateString()}</p>
                                        <p className="text-xs text-orange-600">{daysUntil} days away</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Estimated Cost</p>
                                        <p className="text-sm font-medium text-slate-900">${pred.estimatedCost}</p>
                                    </div>
                                </div>

                                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                                    <p className="text-sm text-blue-900">
                                        <span className="font-medium">Recommendation:</span> {pred.recommendedAction}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Optimal Replacement Timing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Replacement Optimization</h3>
                    <div className="space-y-4">
                        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-medium text-green-900">Optimal Window</p>
                                <span className="text-xs font-medium text-green-700 bg-green-200 px-2 py-1 rounded">RECOMMENDED</span>
                            </div>
                            <p className="text-2xl font-bold text-green-900">Dec 20 - Jan 5</p>
                            <p className="text-xs text-green-700 mt-1">Lowest cost period with minimal disruption</p>
                        </div>
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                            <p className="text-sm font-medium text-yellow-900 mb-2">Alternative Window</p>
                            <p className="text-lg font-bold text-yellow-900">Jan 15 - Jan 30</p>
                            <p className="text-xs text-yellow-700 mt-1">Slightly higher cost but more flexible</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Risk Assessment</h3>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200">
                            <div>
                                <p className="text-sm font-medium text-red-900">Critical Components</p>
                                <p className="text-xs text-red-700">Require immediate attention</p>
                            </div>
                            <p className="text-2xl font-bold text-red-900">2</p>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                            <div>
                                <p className="text-sm font-medium text-yellow-900">Warning Level</p>
                                <p className="text-xs text-yellow-700">Monitor closely</p>
                            </div>
                            <p className="text-2xl font-bold text-yellow-900">5</p>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200">
                            <div>
                                <p className="text-sm font-medium text-green-900">Healthy</p>
                                <p className="text-xs text-green-700">No action needed</p>
                            </div>
                            <p className="text-2xl font-bold text-green-900">38</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ML Model Info */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-blue-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232 1.232 3.227 0 4.458l-1.403 1.403c-1.232 1.232-3.227 1.232-4.458 0l-1.403-1.403M5 14.5V12a9 9 0 0 1 9-9 9 9 0 0 1 9 9v2.5" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <h4 className="text-sm font-bold text-slate-900 mb-1">AI Model Information</h4>
                        <p className="text-sm text-slate-600">
                            Predictions are generated using machine learning models trained on historical maintenance data,
                            vehicle usage patterns, and component wear rates. Model accuracy: 89% (based on last 1000 predictions).
                        </p>
                        <p className="text-xs text-slate-500 mt-2">Last updated: {new Date().toLocaleDateString()}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
