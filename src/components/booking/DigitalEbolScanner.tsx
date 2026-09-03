'use client';

import React, { useState } from 'react';
import {
  Barcode,
  QrCode,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Building2,
  Truck,
  Printer,
  Download,
  AlertCircle,
  Package,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  ConsignmentPalletItem,
  DigitalEBOLRecord,
  createDigitalEBOL,
  parseGs1Barcode,
} from '@/lib/digital-ebol-engine';

interface DigitalEbolScannerProps {
  bookingRef?: string;
  shipperName?: string;
  shipperAddress?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  onEbolGenerated?: (ebol: DigitalEBOLRecord) => void;
}

const INITIAL_PALLETS: ConsignmentPalletItem[] = [
  {
    palletId: 'PAL-EIN360-001',
    gs1Barcode: '(01)06291100000001(10)LOT-2026-A(21)SN987654(3102)000550',
    gtin: '06291100000001',
    batchLot: 'LOT-2026-A',
    serialNumber: 'SN987654',
    description: 'Medical Cold-Chain Vaccines & Pharma Supps',
    palletType: 'EURO_PALLET_EPAL',
    weightKg: 550,
    dimensionsCm: { l: 120, w: 80, h: 140 },
    hazardousCode: null,
    temperatureRange: '-18°C Frozen',
    scannedAt: '2026-09-03T13:30:00.000Z',
    scannedBy: 'Warehouse Dock Scanner #2',
    verificationStatus: 'VERIFIED_LOADED',
  },
  {
    palletId: 'PAL-EIN360-002',
    gs1Barcode: '(01)06291100000002(10)LOT-2026-B(21)SN987655(3102)000620',
    gtin: '06291100000002',
    batchLot: 'LOT-2026-B',
    serialNumber: 'SN987655',
    description: 'Fresh Dairy & Cold-Chain Organic Goods',
    palletType: 'EURO_PALLET_EPAL',
    weightKg: 620,
    dimensionsCm: { l: 120, w: 80, h: 150 },
    hazardousCode: null,
    temperatureRange: '+4°C Chilled',
    scannedAt: '2026-09-03T13:31:00.000Z',
    scannedBy: 'Warehouse Dock Scanner #2',
    verificationStatus: 'VERIFIED_LOADED',
  },
  {
    palletId: 'PAL-EIN360-003',
    gs1Barcode: '(01)06291100000003(10)LOT-2026-C(21)SN987656(3102)000480',
    gtin: '06291100000003',
    batchLot: 'LOT-2026-C',
    serialNumber: 'SN987656',
    description: 'Ambient Dry Packaging & Dispensary Supplies',
    palletType: 'ISO_STANDARD',
    weightKg: 480,
    dimensionsCm: { l: 120, w: 100, h: 130 },
    hazardousCode: null,
    temperatureRange: 'Ambient (22°C)',
    scannedAt: null,
    scannedBy: null,
    verificationStatus: 'PENDING',
  },
];

export function DigitalEbolScanner({
  bookingRef = 'EXL-FRT-9821',
  shipperName = 'EIN360 General Trading LLC',
  shipperAddress = 'JAFZA Logistics Park Gate 4, Warehouse 12B, Dubai',
  consigneeName = 'Dubai Mall Service Dock 3, Downtown Dubai',
  consigneeAddress = 'Financial Centre Rd, Downtown Dubai',
  onEbolGenerated,
}: DigitalEbolScannerProps) {
  const [items, setItems] = useState<ConsignmentPalletItem[]>(INITIAL_PALLETS);
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // e-BOL record state
  const [generatedEbol, setGeneratedEbol] = useState<DigitalEBOLRecord | null>(null);
  const [showEbolModal, setShowEbolModal] = useState(false);

  // Scan / Verify specific pallet
  const handleScanBarcode = async (barcodeToScan?: string) => {
    const code = barcodeToScan || scanInput;
    if (!code) return;

    setScanning(true);
    setScanFeedback(null);

    try {
      const res = await fetch('/api/logistics/ebol/scan-pallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: code }),
      });

      const json = await res.json();
      if (res.ok) {
        // Update items state
        setItems((prev) =>
          prev.map((item) =>
            item.gs1Barcode === code || item.verificationStatus === 'PENDING'
              ? {
                  ...item,
                  verificationStatus: 'VERIFIED_LOADED',
                  scannedAt: new Date().toISOString(),
                  scannedBy: 'Mobile Dock Scanner #1',
                }
              : item
          )
        );
        setScanFeedback(`✅ Pallet Barcode Verified: ${json.parsed?.batchLot || code}`);
        setScanInput('');
      }
    } catch {
      setScanFeedback('❌ Scan failed');
    } finally {
      setScanning(false);
    }
  };

  // 1-Click Verify All Pallets
  const handleVerifyAll = () => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        verificationStatus: 'VERIFIED_LOADED',
        scannedAt: new Date().toISOString(),
        scannedBy: 'Master Dock Scanner',
      }))
    );
    setScanFeedback('✅ All manifest pallets verified and loaded');
  };

  // Generate Official Electronic Bill of Lading (e-BOL)
  const handleGenerateEbol = async () => {
    const ebol = createDigitalEBOL({
      bookingRef,
      shipperName,
      shipperAddress,
      shipperContact: '+971 4 888 1234',
      consigneeName,
      consigneeAddress,
      consigneeContact: '+971 4 999 5678',
      items,
    });

    setGeneratedEbol(ebol);
    setShowEbolModal(true);
    if (onEbolGenerated) onEbolGenerated(ebol);
  };

  const loadedCount = items.filter((i) => i.verificationStatus === 'VERIFIED_LOADED').length;
  const totalWeight = items.reduce((sum, i) => sum + i.weightKg, 0);

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Barcode className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Consignment Barcode Scanner & Electronic Bill of Lading (e-BOL)
          </span>
        </div>
        <span className="text-[10px] bg-cyan-500/10 text-cyan-300 font-mono font-bold px-2 py-0.5 rounded-full border border-cyan-500/20">
          GS1-128 Compliant
        </span>
      </div>

      {/* Dock Scanner Input Bar */}
      <div className="bg-slate-950/60 border border-white/10 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <label className="font-bold text-slate-300 flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5 text-orange-400" />
            Warehouse Dock Pallet Scanner
          </label>
          <span className="text-[11px] text-emerald-400 font-bold">
            {loadedCount} / {items.length} Pallets Loaded ({totalWeight} kg)
          </span>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="Scan GS1-128 or QR barcode on pallet label…"
            className="flex-1 bg-slate-900 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <button
            type="button"
            onClick={() => handleScanBarcode()}
            disabled={scanning}
            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold transition-all shadow-md"
          >
            {scanning ? 'Scanning…' : 'Scan Pallet'}
          </button>
        </div>

        {/* 1-Click Pallet Simulation Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-slate-400">Quick Test Scans:</span>
          <button
            type="button"
            onClick={() =>
              handleScanBarcode('(01)06291100000003(10)LOT-2026-C(21)SN987656(3102)000480')
            }
            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded border border-white/10 font-mono"
          >
            Scan Pallet #3 (LOT-2026-C)
          </button>
          <button
            type="button"
            onClick={handleVerifyAll}
            className="text-[10px] bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30"
          >
            ⚡ Scan All 3 Pallets
          </button>
        </div>

        {scanFeedback && (
          <p className="text-xs text-emerald-300 font-mono pt-1">{scanFeedback}</p>
        )}
      </div>

      {/* Manifest Items Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/80 text-slate-400 text-[10px] uppercase font-mono">
            <tr>
              <th className="p-2.5">Pallet ID & GS1</th>
              <th className="p-2.5">Cargo Description</th>
              <th className="p-2.5">Type & Weight</th>
              <th className="p-2.5">Temp Condition</th>
              <th className="p-2.5 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-slate-900/40">
            {items.map((pallet) => (
              <tr key={pallet.palletId} className="hover:bg-white/[0.02]">
                <td className="p-2.5 font-mono">
                  <span className="font-bold text-white block">{pallet.palletId}</span>
                  <span className="text-[9px] text-slate-500 truncate max-w-[140px] block">
                    {pallet.gs1Barcode}
                  </span>
                </td>
                <td className="p-2.5 text-slate-200">{pallet.description}</td>
                <td className="p-2.5 font-mono text-slate-300">
                  {pallet.palletType === 'EURO_PALLET_EPAL' ? 'Euro EPAL' : 'ISO Standard'} ·{' '}
                  <strong className="text-white">{pallet.weightKg} kg</strong>
                </td>
                <td className="p-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                    {pallet.temperatureRange || 'Ambient'}
                  </span>
                </td>
                <td className="p-2.5 text-right">
                  {pallet.verificationStatus === 'VERIFIED_LOADED' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Loaded
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/20 font-bold">
                      ⏳ Pending Scan
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate Official e-BOL Action Button */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-slate-400">
          Customs Ready: <strong>UAE Customs Declaration & SHA-256 Seal</strong>
        </div>
        <button
          type="button"
          onClick={handleGenerateEbol}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 transition-all"
        >
          <FileText className="w-4 h-4" />
          Generate Official Electronic Bill of Lading (e-BOL)
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          OFFICIAL DIGITAL e-BOL DOCUMENT MODAL
      ══════════════════════════════════════════════════════════════ */}
      {showEbolModal && generatedEbol && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl text-white">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white font-bold text-lg">
                  🚛
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Official Electronic Bill of Lading (e-BOL)
                  </h3>
                  <p className="text-xs text-orange-400 font-mono">{generatedEbol.ebolNumber}</p>
                </div>
              </div>
              <button
                onClick={() => setShowEbolModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕ Close
              </button>
            </div>

            {/* Official e-BOL Sheet Document */}
            <div className="bg-slate-950 border border-white/15 rounded-xl p-5 space-y-4 text-xs">
              {/* Carrier & Customs Top Banner */}
              <div className="grid grid-cols-2 gap-4 border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">
                    Issuing Freight Carrier
                  </span>
                  <strong className="text-white text-sm block">{generatedEbol.carrierName}</strong>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Trade License: {generatedEbol.carrierTradeLicense}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">
                    UAE Customs Declaration No.
                  </span>
                  <strong className="text-emerald-400 text-sm font-mono block">
                    {generatedEbol.uaeCustomsDeclarationNo}
                  </strong>
                  <span className="text-[10px] text-slate-400">
                    Sealed: {new Date(generatedEbol.issuedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Shipper & Consignee */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/60 p-3 rounded-lg border border-white/5 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Shipper / Origin:
                  </span>
                  <strong className="text-white block">{generatedEbol.shipperName}</strong>
                  <p className="text-[11px] text-slate-300">{generatedEbol.shipperAddress}</p>
                </div>
                <div className="bg-slate-900/60 p-3 rounded-lg border border-white/5 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Consignee / Destination:
                  </span>
                  <strong className="text-white block">{generatedEbol.consigneeName}</strong>
                  <p className="text-[11px] text-slate-300">{generatedEbol.consigneeAddress}</p>
                </div>
              </div>

              {/* Manifest Summary */}
              <div className="border-t border-white/10 pt-3 space-y-2">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  Consignment Cargo Manifest ({generatedEbol.totalPallets} Units ·{' '}
                  {generatedEbol.totalGrossWeightKg} kg Total Gross Weight)
                </span>
                <div className="space-y-1 text-[11px]">
                  {generatedEbol.items.map((item, idx) => (
                    <div
                      key={item.palletId}
                      className="flex justify-between bg-slate-900/40 p-2 rounded border border-white/5"
                    >
                      <span>
                        <strong>{idx + 1}. {item.palletId}</strong> — {item.description} ({item.temperatureRange})
                      </span>
                      <span className="font-mono text-slate-300">{item.weightKg} kg</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SHA-256 Cryptographic Seal */}
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3 space-y-1 text-[10px]">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Cryptographically Sealed with SHA-256
                  </span>
                  <span>Tamper-Proof Seal</span>
                </div>
                <p className="font-mono text-slate-400 break-all">{generatedEbol.cryptographicSeal}</p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                <Printer className="w-4 h-4" /> Print e-BOL PDF
              </button>
              <button
                type="button"
                onClick={() => setShowEbolModal(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-md"
              >
                Done & Attach to Shipment →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
