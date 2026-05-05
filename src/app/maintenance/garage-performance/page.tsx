'use client';

import { useState } from 'react';
import {
    GaragePerformance,
    Garage
} from '@/types/maintenance';

export default function GaragePerformancePage() {
    // Mock garage performance data
    const [garagePerformance] = useState<GaragePerformance[]>([
        {
            garageId: 'g1',
            garageName: 'AutoFix Pro',
            totalJobs: 45,
            completedJobs: 42,
            averageCompletionTime: 3.2,
            averageCost: 850,
            customerSatisfaction: 4.5,
            onTimeDeliveryRate: 93,
            qualityScore: 88,
            responseTime: 2.5,
            costVariance: -5,
            period: '2024-Q4'
        },
        {
            garageId: 'g2',
            garageName: 'QuickFix Motors',
            totalJobs: 38,
            completedJobs: 35,
            averageCompletionTime: 4.1,
            averageCost: 920,
            customerSatisfaction: 4.2,
            onTimeDeliveryRate: 85,
            qualityScore: 82,
            responseTime: 3.2,
            costVariance: 8,
            period: '2024-Q4'
        },
        {
            garageId: 'g3',
            garageName: 'Elite Auto Service',
            totalJobs: 52,
            completedJobs: 50,
            averageCompletionTime: 2.8,
            averageCost: 780,
            customerSatisfaction: 4.7,
            onTimeDeliveryRate: 96,
            qualityScore: 92,
            responseTime: 1.8,
            costVariance: -12,
            period: '2024-Q4'
        }
    ]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-green-600';
        if (score >= 75) return 'text-yellow-600';
        if (score >= 60) return 'text-orange-600';
        return 'text-red-600';
    };

    const getScoreBg = (score: number) => {
        if (score >= 90) return 'bg-emerald-500/20 border-green-300';
        if (score >= 75) return 'bg-amber-500/20 border-yellow-300';
        if (score >= 60) return 'bg-orange-500/20 border-orange-300';
        return 'bg-red-500/20 border-red-300';
    };

    // Calculate rankings
    const rankedGarages = [...garagePerformance].sort((a, b) => {
        const scoreA = (a.qualityScore + a.onTimeDeliveryRate + (a.customerSatisfaction * 20)) / 3;
        const scoreB = (b.qualityScore + b.onTimeDeliveryRate + (b.customerSatisfaction * 20)) / 3;
        return scoreB - scoreA;
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Garage Performance Metrics</h1>
                <p className="mt-1 text-slate-500">Compare and analyze garage performance across key metrics</p>
            </div>

            {/* Rankings */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4">Overall Rankings</h3>
                <div className="space-y-3">
                    {rankedGarages.map((garage, idx) => {
                        const overallScore = Math.round((garage.qualityScore + garage.onTimeDeliveryRate + (garage.customerSatisfaction * 20)) / 3);
                        return (
                            <div key={garage.garageId} className="flex items-center gap-4 p-4 rounded-lg border border-white/10 bg-slate-800/50">
                                <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${idx === 0 ? 'bg-amber-500/20 text-yellow-700' :
                                        idx === 1 ? 'bg-slate-200 text-slate-300' :
                                            idx === 2 ? 'bg-orange-500/20 text-orange-700' :
                                                'bg-slate-700/40 text-slate-600'
                                    }`}>
                                    #{idx + 1}
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-base font-bold text-white">{garage.garageName}</h4>
                                    <p className="text-sm text-slate-500">{garage.completedJobs} jobs completed</p>
                                </div>
                                <div className="text-right">
                                    <p className={`text-2xl font-bold ${getScoreColor(overallScore)}`}>{overallScore}</p>
                                    <p className="text-xs text-slate-500">Overall Score</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Detailed Metrics */}
            <div className="grid grid-cols-1 gap-6">
                {garagePerformance.map(garage => {
                    const overallScore = Math.round((garage.qualityScore + garage.onTimeDeliveryRate + (garage.customerSatisfaction * 20)) / 3);

                    return (
                        <div key={garage.garageId} className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                            <div className="p-6 border-b border-white/10 flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-white">{garage.garageName}</h3>
                                    <p className="text-sm text-slate-500">{garage.period}</p>
                                </div>
                                <div className={`rounded-full px-4 py-2 border ${getScoreBg(overallScore)}`}>
                                    <p className={`text-2xl font-bold ${getScoreColor(overallScore)}`}>{overallScore}</p>
                                </div>
                            </div>

                            <div className="p-6">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                                    <div>
                                        <p className="text-sm text-slate-500">Total Jobs</p>
                                        <p className="text-2xl font-bold text-white">{garage.totalJobs}</p>
                                        <p className="text-xs text-green-600">{garage.completedJobs} completed</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-500">Avg Completion</p>
                                        <p className="text-2xl font-bold text-white">{garage.averageCompletionTime}d</p>
                                        <p className="text-xs text-slate-500">days</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-500">Avg Cost</p>
                                        <p className="text-2xl font-bold text-white">${garage.averageCost}</p>
                                        <p className={`text-xs ${garage.costVariance < 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {garage.costVariance > 0 ? '+' : ''}{garage.costVariance}% variance
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-500">Response Time</p>
                                        <p className="text-2xl font-bold text-white">{garage.responseTime}h</p>
                                        <p className="text-xs text-slate-500">hours</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-slate-300">Quality Score</span>
                                            <span className={`text-sm font-bold ${getScoreColor(garage.qualityScore)}`}>{garage.qualityScore}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-3">
                                            <div
                                                className={`h-3 rounded-full ${garage.qualityScore >= 90 ? 'bg-green-600' : garage.qualityScore >= 75 ? 'bg-yellow-600' : 'bg-orange-600'}`}
                                                style={{ width: `${garage.qualityScore}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-slate-300">On-Time Delivery</span>
                                            <span className={`text-sm font-bold ${getScoreColor(garage.onTimeDeliveryRate)}`}>{garage.onTimeDeliveryRate}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-3">
                                            <div
                                                className={`h-3 rounded-full ${garage.onTimeDeliveryRate >= 90 ? 'bg-green-600' : garage.onTimeDeliveryRate >= 75 ? 'bg-yellow-600' : 'bg-orange-600'}`}
                                                style={{ width: `${garage.onTimeDeliveryRate}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-slate-300">Customer Satisfaction</span>
                                            <span className="text-sm font-bold text-white">{garage.customerSatisfaction}/5.0 ⭐</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-3">
                                            <div
                                                className="bg-blue-600 h-3 rounded-full"
                                                style={{ width: `${(garage.customerSatisfaction / 5) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Comparison Table */}
            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-lg font-bold text-white">Side-by-Side Comparison</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-white/10">
                        <thead className="bg-slate-800/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Metric</th>
                                {garagePerformance.map(g => (
                                    <th key={g.garageId} className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">{g.garageName}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 bg-slate-900">
                            <tr>
                                <td className="px-6 py-4 text-sm font-medium text-white">Quality Score</td>
                                {garagePerformance.map(g => (
                                    <td key={g.garageId} className={`px-6 py-4 text-sm font-bold ${getScoreColor(g.qualityScore)}`}>{g.qualityScore}%</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 text-sm font-medium text-white">On-Time Delivery</td>
                                {garagePerformance.map(g => (
                                    <td key={g.garageId} className={`px-6 py-4 text-sm font-bold ${getScoreColor(g.onTimeDeliveryRate)}`}>{g.onTimeDeliveryRate}%</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 text-sm font-medium text-white">Satisfaction</td>
                                {garagePerformance.map(g => (
                                    <td key={g.garageId} className="px-6 py-4 text-sm font-bold text-white">{g.customerSatisfaction}/5.0</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 text-sm font-medium text-white">Avg Cost</td>
                                {garagePerformance.map(g => (
                                    <td key={g.garageId} className="px-6 py-4 text-sm font-bold text-white">${g.averageCost}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="px-6 py-4 text-sm font-medium text-white">Response Time</td>
                                {garagePerformance.map(g => (
                                    <td key={g.garageId} className="px-6 py-4 text-sm font-bold text-white">{g.responseTime}h</td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
