'use client';

import { useState, useEffect } from 'react';

export default function PredictiveMaintenancePage() {
    const [predictions, setPredictions] = useState<any[]>([]);
    const [optimization, setOptimization] = useState<any>(null);
    const [costForecast, setCostForecast] = useState<any>(null);
    const [riskAssessment, setRiskAssessment] = useState<any>(null);

    useEffect(() => {
        const fetchPredictions = async () => {
            try {
                const response = await fetch('http://localhost:8080/api/maintenance/predictive');
                if (response.ok) {
                    const data = await response.json();
                    setPredictions(data.predictions || []);
                    setOptimization(data.optimization || null);
                    setCostForecast(data.costForecast || null);
                    setRiskAssessment(data.riskAssessment || null);
                }
            } catch (error) {
                console.error("Failed to fetch predictions:", error);
            }
        };
        fetchPredictions();
    }, []);

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

    // State for risk drill-down
    const [selectedRiskDetails, setSelectedRiskDetails] = useState<'High' | 'Medium' | 'Low' | null>(null);
    const [selectedOptimizationView, setSelectedOptimizationView] = useState<'Optimal' | 'Alternative' | null>(null);

    // Filter predictions logic
    const getFilteredPredictions = () => {
        if (selectedRiskDetails) {
            return predictions.filter(p => p.riskLevel === selectedRiskDetails);
        }
        if (selectedOptimizationView) {
            // Optimization windows are driven by High Risk items
            return predictions.filter(p => p.riskLevel === 'High');
        }
        return [];
    };

    const filteredPredictions = getFilteredPredictions();

    // Helper for modal title
    const getModalTitle = () => {
        if (selectedRiskDetails === 'High') return 'Critical Components';
        if (selectedRiskDetails === 'Medium') return 'Warning Level Components';
        if (selectedRiskDetails === 'Low') return 'Healthy Components';
        if (selectedOptimizationView === 'Optimal') return 'Optimal Replacement Plan (High Risk)';
        if (selectedOptimizationView === 'Alternative') return 'Just-In-Time Replacement (High Risk)';
        return '';
    };

    // Helper for closing modal
    const closeModal = () => {
        setSelectedRiskDetails(null);
        setSelectedOptimizationView(null);
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
                {costForecast ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white rounded-lg p-4 border border-blue-200">
                            <p className="text-sm text-slate-500">This Month</p>
                            <p className="text-2xl font-bold text-slate-900">AED {costForecast.currentMonth.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-blue-200">
                            <p className="text-sm text-slate-500">Next Month</p>
                            <p className="text-2xl font-bold text-blue-600">AED {costForecast.nextMonth.toLocaleString()}</p>
                            <p className={`text-xs ${costForecast.trend === 'increasing' ? 'text-orange-600 font-bold' : 'text-green-600'}`}>
                                {costForecast.trend === 'increasing' ? '↑ Increasing Trend' : '↓ Decreasing Trend'}
                            </p>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-blue-200">
                            <p className="text-sm text-slate-500">Next 3 Months</p>
                            <p className="text-2xl font-bold text-slate-900">AED {costForecast.next3Months.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-blue-200">
                            <p className="text-sm text-slate-500">Next 6 Months</p>
                            <p className="text-2xl font-bold text-slate-900">AED {costForecast.next6Months.toLocaleString()}</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-slate-500">Loading forecast...</p>
                )}
            </div>

            {/* Failure Predictions */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="p-6 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-900">Predicted Failures</h3>
                    <p className="text-sm text-slate-500">Components likely to fail based on ML analysis</p>
                </div>
                <div className="divide-y divide-slate-200">
                    {predictions.length > 0 ? (
                        predictions.map((pred, idx) => {
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
                                            <p className="text-sm font-medium text-slate-900">AED {pred.estimatedCost}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                                        <p className="text-sm text-blue-900">
                                            <span className="font-medium">Recommendation:</span> {pred.recommendedAction}
                                        </p>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="p-6 text-center text-slate-500">No predictions found.</div>
                    )}
                </div>
            </div>

            {/* Optimal Replacement Timing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Replacement Optimization</h3>
                    {optimization ? (
                        <div className="space-y-4">
                            <div
                                onClick={() => setSelectedOptimizationView('Optimal')}
                                className="rounded-lg border border-green-200 bg-green-50 p-4 cursor-pointer hover:bg-green-100 transition-colors"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-sm font-medium text-green-900 flex items-center gap-2">
                                        Optimal Window
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-600">
                                            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                                        </svg>
                                    </p>
                                    <span className="text-xs font-medium text-green-700 bg-green-200 px-2 py-1 rounded">RECOMMENDED</span>
                                </div>
                                <p className="text-2xl font-bold text-green-900">{optimization.optimalWindow}</p>
                                <p className="text-xs text-green-700 mt-1">{optimization.optimalReason}</p>
                            </div>
                            <div
                                onClick={() => setSelectedOptimizationView('Alternative')}
                                className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 cursor-pointer hover:bg-yellow-100 transition-colors"
                            >
                                <p className="text-sm font-medium text-yellow-900 mb-2 flex items-center gap-2">
                                    Alternative Window
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-yellow-600">
                                        <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                                    </svg>
                                </p>
                                <p className="text-lg font-bold text-yellow-900">{optimization.altWindow}</p>
                                <p className="text-xs text-yellow-700 mt-1">{optimization.altReason}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-slate-500">Loading optimization data...</p>
                    )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Risk Assessment</h3>
                    {riskAssessment ? (
                        <div className="space-y-3">
                            <div
                                onClick={() => setSelectedRiskDetails('High')}
                                className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200 cursor-pointer hover:bg-red-100 transition-colors"
                            >
                                <div>
                                    <p className="text-sm font-medium text-red-900 flex items-center gap-2">
                                        Critical Components
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-600">
                                            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                                        </svg>
                                    </p>
                                    <p className="text-xs text-red-700">Require immediate attention</p>
                                </div>
                                <p className="text-2xl font-bold text-red-900">{riskAssessment.critical}</p>
                            </div>
                            <div
                                onClick={() => setSelectedRiskDetails('Medium')}
                                className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-200 cursor-pointer hover:bg-yellow-100 transition-colors"
                            >
                                <div>
                                    <p className="text-sm font-medium text-yellow-900 flex items-center gap-2">
                                        Warning Level
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-yellow-600">
                                            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                                        </svg>
                                    </p>
                                    <p className="text-xs text-yellow-700">Monitor closely</p>
                                </div>
                                <p className="text-2xl font-bold text-yellow-900">{riskAssessment.warning}</p>
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200">
                                <div>
                                    <p className="text-sm font-medium text-green-900">Healthy</p>
                                    <p className="text-xs text-green-700">No action needed</p>
                                </div>
                                <p className="text-2xl font-bold text-green-900">{riskAssessment.healthy}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-slate-500">Loading risk assessment...</p>
                    )}
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

            {/* Modal for Risk/Optimization Details */}
            {(selectedRiskDetails || selectedOptimizationView) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between p-6 border-b border-slate-200">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xl font-bold text-slate-900">
                                    {getModalTitle()}
                                </h3>
                                {selectedRiskDetails && (
                                    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getRiskColor(selectedRiskDetails)}`}>
                                        {selectedRiskDetails} Risk
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={closeModal}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {filteredPredictions.length > 0 ? (
                                <div className="space-y-4">
                                    {filteredPredictions.map((pred, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-4 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                                            <div>
                                                <h4 className="font-bold text-slate-900">{pred.vehicleName}</h4>
                                                <p className="text-sm text-slate-600">Component: <span className="font-medium text-slate-900">{pred.component}</span></p>
                                                <p className="text-xs text-slate-500 mt-1">Predicted Failure: {new Date(pred.predictedFailureDate).toLocaleDateString()}</p>
                                            </div>
                                            <div className="text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <div className="text-sm font-medium text-slate-900">Condition: {pred.currentCondition}%</div>
                                                    <div className="w-24 bg-slate-200 rounded-full h-1.5">
                                                        <div
                                                            className={`h-1.5 rounded-full ${getConditionColor(pred.currentCondition)}`}
                                                            style={{ width: `${pred.currentCondition}%` }}
                                                        />
                                                    </div>
                                                </div>
                                                <p className="text-xs text-blue-600 font-medium mt-2">Confidence: {pred.confidence}%</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-slate-500">
                                    <p>No components found in this category.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-end">
                            <button
                                onClick={closeModal}
                                className="px-5 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
