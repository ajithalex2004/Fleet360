'use client';

import React, { useState } from 'react';
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  ShieldCheck,
  Building2,
  FileCheck,
  Truck,
  Sparkles,
  Layers,
  ArrowRight,
  Download,
  AlertCircle,
  Leaf,
  Clock,
  Send,
} from 'lucide-react';
import {
  BulkUploadAnalysisResult,
  SAMPLE_BULK_CSV_CONTENT,
  analyzeBulkConsignmentUpload,
} from '@/lib/bulk-consignment-engine';

interface BulkConsignmentUploaderProps {
  onBatchDispatched?: (result: BulkUploadAnalysisResult) => void;
}

export function BulkConsignmentUploader({ onBatchDispatched }: BulkConsignmentUploaderProps) {
  const [analysis, setAnalysis] = useState<BulkUploadAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const [viewTab, setViewTab] = useState<'CLUSTERS' | 'TABLE'>('CLUSTERS');

  // Load sample 10-store manifest
  const handleLoadSampleManifest = () => {
    setLoading(true);
    setTimeout(() => {
      const res = analyzeBulkConsignmentUpload('EIN360_Retail_Distribution_10_Stores.csv', SAMPLE_BULK_CSV_CONTENT);
      setAnalysis(res);
      setLoading(false);
      setDispatched(false);
    }, 400);
  };

  // Handle file drop/upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const res = analyzeBulkConsignmentUpload(file.name, text);
      setAnalysis(res);
      setLoading(false);
      setDispatched(false);
    };
    reader.readAsText(file);
  };

  // 1-Click Master Dispatch
  const handleDispatchBatch = async () => {
    if (!analysis) return;
    setLoading(true);

    try {
      await fetch('/api/logistics/bulk-consignments/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterManifestNumber: analysis.masterManifestNumber,
          clustersCount: analysis.clusters.length,
          totalPallets: analysis.totalPallets,
          totalFareAed: analysis.summaryPricingAed,
        }),
      });

      setDispatched(true);
      if (onBatchDispatched) onBatchDispatched(analysis);
    } catch {}
    setLoading(false);
  };

  return (
    <div className="bg-zinc-950/80 border border-amber-500/20 hover:border-amber-500/40 rounded-2xl p-5 space-y-5 backdrop-blur-xl shadow-xl shadow-amber-500/5 transition-all">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            B2B Bulk Consignment Excel / CSV Ingestion Engine
          </span>
        </div>
        <span className="text-[10px] bg-amber-500/15 text-amber-300 font-mono font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
          LTL Multi-Drop Auto-Clustering
        </span>
      </div>

      {/* Upload Dropzone & Sample Loader */}
      {!analysis && (
        <div className="border-2 border-dashed border-amber-500/30 hover:border-amber-400/60 rounded-2xl p-6 text-center space-y-3 bg-zinc-950/60 transition-all">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Upload B2B Freight Manifest (.csv or .xlsx)</h4>
            <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1">
              Upload multi-store consignments. Fleet360 will automatically validate addresses, cluster regional
              corridors, and generate optimized vehicle sequences.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <label className="cursor-pointer px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-400 hover:to-yellow-500 text-black text-xs font-bold shadow-lg shadow-amber-500/25 transition-all">
              Choose Spreadsheet File
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              type="button"
              onClick={handleLoadSampleManifest}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-amber-300 text-xs font-bold border border-amber-500/30 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Load 10-Store Retail Manifest Demo
            </button>
          </div>
        </div>
      )}

      {/* Uploaded Manifest Analysis View */}
      {analysis && (
        <div className="space-y-4">
          {/* Top Metrics Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Consignments</span>
              <span className="text-xl font-mono font-bold text-white block mt-0.5">
                {analysis.validRowsCount} Drops
              </span>
              <span className="text-[10px] text-emerald-400">100% Validated</span>
            </div>

            <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Pallets & Weight</span>
              <span className="text-xl font-mono font-bold text-cyan-300 block mt-0.5">
                {analysis.totalPallets} EPAL
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {(analysis.totalWeightKg / 1000).toFixed(1)} Tons Gross
              </span>
            </div>

            <div className="bg-slate-950/80 border border-emerald-500/30 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Optimized Routes</span>
              <span className="text-xl font-mono font-bold text-emerald-400 block mt-0.5">
                {analysis.clusters.length} Dedicated Trucks
              </span>
              <span className="text-[10px] text-emerald-300">Auto-Clustered</span>
            </div>

            <div className="bg-slate-950/80 border border-white/10 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Estimated Freight</span>
              <span className="text-xl font-mono font-bold text-white block mt-0.5">
                AED {analysis.summaryPricingAed.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-400">All Corridors & Tolls</span>
            </div>
          </div>

          {/* View Tab Toggle & Reset */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setViewTab('CLUSTERS')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  viewTab === 'CLUSTERS'
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🚚 Clustered Vehicle Routes ({analysis.clusters.length})
              </button>
              <button
                type="button"
                onClick={() => setViewTab('TABLE')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  viewTab === 'TABLE'
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📋 Raw Consignment Grid ({analysis.totalRows})
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAnalysis(null)}
              className="text-xs text-orange-400 hover:text-orange-300"
            >
              Upload Another File ↺
            </button>
          </div>

          {/* TAB 1: CLUSTERED VEHICLE ROUTES */}
          {viewTab === 'CLUSTERS' && (
            <div className="space-y-3">
              {analysis.clusters.map((cluster, idx) => (
                <div
                  key={cluster.clusterId}
                  className="bg-slate-950/90 border border-white/10 rounded-xl p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono font-bold flex items-center justify-center text-[10px]">
                          {idx + 1}
                        </span>
                        <h4 className="font-bold text-white text-sm">{cluster.corridorName}</h4>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Assigned Vehicle: <strong className="text-emerald-300">{cluster.vehicleRecommended}</strong>
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-white block">
                        AED {cluster.totalFreightFareAed.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 justify-end">
                        <Leaf className="w-3 h-3 text-emerald-400" /> {cluster.co2SavingsKg} kg CO₂ saved
                      </span>
                    </div>
                  </div>

                  {/* Stops Sequence */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                      Optimized TSP Delivery Sequence ({cluster.stopsSequence.length} Drops):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {cluster.stopsSequence.map((stop) => (
                        <div
                          key={stop.stopNo}
                          className="bg-slate-900 border border-white/5 rounded-lg p-2 space-y-0.5"
                        >
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-bold text-orange-400">Stop #{stop.stopNo}</span>
                            <span className="font-mono text-cyan-300">{stop.pallets} Pallets</span>
                          </div>
                          <strong className="text-white block truncate text-xs">{stop.consigneeName}</strong>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                            <Clock className="w-3 h-3 text-slate-500" /> {stop.timeWindow}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Load Factor Progress */}
                  <div className="bg-slate-900/60 rounded-lg p-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Truck Load Factor:{' '}
                      <strong className="text-white font-mono">{cluster.capacityUtilizationPercent}% Full</strong> (
                      {cluster.totalPallets} / {cluster.vehicleMaxCapacityPallets} EPAL Pallets)
                    </span>
                    <div className="w-32 bg-slate-800 rounded-full h-2 overflow-hidden border border-white/10">
                      <div
                        className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full"
                        style={{ width: `${cluster.capacityUtilizationPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: RAW CONSIGNMENTS TABLE */}
          {viewTab === 'TABLE' && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-[11px] text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[9px] border-b border-white/10">
                  <tr>
                    <th className="p-2.5">Ref #</th>
                    <th className="p-2.5">Consignee</th>
                    <th className="p-2.5">Address</th>
                    <th className="p-2.5">Pallets</th>
                    <th className="p-2.5">Weight</th>
                    <th className="p-2.5">Category</th>
                    <th className="p-2.5">Receiver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-slate-900/80 font-mono">
                  {analysis.clusters
                    .flatMap((c) => c.consignments)
                    .map((item) => (
                      <tr key={item.consignmentRef} className="hover:bg-slate-800/50">
                        <td className="p-2.5 font-bold text-orange-400">{item.consignmentRef}</td>
                        <td className="p-2.5 text-white font-sans">{item.consigneeName}</td>
                        <td className="p-2.5 text-slate-400 font-sans truncate max-w-[150px]">
                          {item.destinationAddress}
                        </td>
                        <td className="p-2.5 text-cyan-300">{item.palletCount}</td>
                        <td className="p-2.5 text-slate-400">{item.grossWeightKg} kg</td>
                        <td className="p-2.5 text-emerald-400 font-sans">{item.cargoCategory}</td>
                        <td className="p-2.5 text-slate-400 font-sans">{item.receiverContactName}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Batch Seal & Dispatch Action */}
          <div className="bg-slate-950 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <ShieldCheck className="w-4 h-4" />
                <span>SHA-256 Batch Manifest Seal:</span>
              </div>
              <span className="font-mono text-slate-500 text-[10px] break-all">
                {analysis.cryptographicBatchSeal.slice(0, 32)}…
              </span>
            </div>

            {!dispatched ? (
              <button
                type="button"
                onClick={handleDispatchBatch}
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all"
              >
                <Send className="w-4 h-4" />
                {loading
                  ? 'Dispatching Master Batch…'
                  : `Confirm & Dispatch All ${analysis.clusters.length} Vehicle Routes (AED ${analysis.summaryPricingAed.toLocaleString()}) →`}
              </button>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-300 text-xs flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Master Manifest {analysis.masterManifestNumber} Dispatched across {analysis.clusters.length} Routes!
                </span>
                <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded font-mono">
                  e-BOLs Released
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
