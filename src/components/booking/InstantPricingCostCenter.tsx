'use client';

import React, { useState, useEffect } from 'react';
import { Calculator, CreditCard, Building2, AlertCircle, CheckCircle2, Receipt, ShieldCheck } from 'lucide-react';
import {
  calculateInstantQuotation,
  QuotationResponse,
} from '@/app/api/booking-portal/quotation/route';

export interface PricingState {
  fareSubtotal: number;
  vatAmount: number;
  totalFareAed: number;
  costCenter: string;
  projectCode: string;
  billingMethod: string;
  budgetStatus: 'WITHIN_POLICY' | 'EXCEEDS_POLICY';
}

interface InstantPricingCostCenterProps {
  serviceType: string;
  vehicleCategory?: string;
  distanceKm?: number;
  salikTollsAed?: number;
  costCenter?: string;
  projectCode?: string;
  billingMethod?: string;
  onChange: (pricing: PricingState) => void;
}

export const CORPORATE_COST_CENTERS = [
  { code: 'CC-EXEC-1001', name: 'Executive Office & C-Suite', budgetCap: 1500 },
  { code: 'CC-MKTG-2002', name: 'Sales & Business Development', budgetCap: 800 },
  { code: 'CC-OPS-3003', name: 'Operations & Fleet Logistics', budgetCap: 1200 },
  { code: 'CC-IT-4004', name: 'Technology & Digital Systems', budgetCap: 600 },
  { code: 'CC-HR-5005', name: 'Human Resources & People', budgetCap: 500 },
  { code: 'CC-FIN-6006', name: 'Finance, Tax & Procurement', budgetCap: 1000 },
];

export const CORPORATE_BILLING_METHODS = [
  { id: 'CORPORATE_ACCOUNT', label: 'Monthly Corporate Master Account (Credit Line)' },
  { id: 'COST_CENTER_DIRECT', label: 'Internal Department Cost Center Chargeback' },
  { id: 'CORPORATE_CARD', label: 'Corporate Card on File (Auto-Billed)' },
  { id: 'PER_DIEM_ALLOWANCE', label: 'Employee Mobility Allowance (Per-Diem)' },
];

export function InstantPricingCostCenter({
  serviceType,
  vehicleCategory,
  distanceKm = 0,
  salikTollsAed = 0,
  costCenter = 'CC-OPS-3003',
  projectCode = '',
  billingMethod = 'CORPORATE_ACCOUNT',
  onChange,
}: InstantPricingCostCenterProps) {
  const [selectedCostCenter, setSelectedCostCenter] = useState<string>(costCenter);
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>(projectCode);
  const [selectedBillingMethod, setSelectedBillingMethod] = useState<string>(billingMethod);
  const [quotation, setQuotation] = useState<QuotationResponse | null>(null);

  useEffect(() => {
    const quote = calculateInstantQuotation({
      serviceType,
      vehicleCategory,
      distanceKm,
      salikTollsAed,
    });
    setQuotation(quote);

    const ccObj = CORPORATE_COST_CENTERS.find(c => c.code === selectedCostCenter);
    const cap = ccObj?.budgetCap || quote.budgetThresholdAed;
    const isOver = quote.totalFareAed > cap;

    onChange({
      fareSubtotal: quote.subtotalAed,
      vatAmount: quote.vatAmountAed,
      totalFareAed: quote.totalFareAed,
      costCenter: selectedCostCenter,
      projectCode: selectedProjectCode,
      billingMethod: selectedBillingMethod,
      budgetStatus: isOver ? 'EXCEEDS_POLICY' : 'WITHIN_POLICY',
    });
  }, [
    serviceType,
    vehicleCategory,
    distanceKm,
    salikTollsAed,
    selectedCostCenter,
    selectedProjectCode,
    selectedBillingMethod,
  ]);

  if (!quotation) return null;

  const currentCc = CORPORATE_COST_CENTERS.find(c => c.code === selectedCostCenter);
  const effectiveCap = currentCc?.budgetCap || quotation.budgetThresholdAed;
  const isOverBudget = quotation.totalFareAed > effectiveCap;

  return (
    <div className="space-y-4">
      {/* ── Live Itemized Fare Receipt Card ── */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/40 border border-violet-500/30 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Instant Corporate Fare Estimation (UAE FTA Compliant)
            </span>
          </div>
          <span className="text-xs text-violet-300 font-mono font-bold">
            {quotation.currency}
          </span>
        </div>

        {/* Itemized lines */}
        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Base Service & Dispatch Fee</span>
            <span className="font-mono text-white">AED {quotation.baseFareAed.toFixed(2)}</span>
          </div>

          {quotation.distanceChargeAed > 0 && (
            <div className="flex justify-between text-slate-400">
              <span>
                Distance Mileage ({quotation.rateCardBreakdown.appliedDistanceKm} km @ AED{' '}
                {quotation.rateCardBreakdown.perKmRate.toFixed(2)}/km)
              </span>
              <span className="font-mono text-white">AED {quotation.distanceChargeAed.toFixed(2)}</span>
            </div>
          )}

          {quotation.salikTollsAed > 0 && (
            <div className="flex justify-between text-amber-400/90">
              <span>UAE Salik & Darb Toll Pass-Through</span>
              <span className="font-mono font-medium">AED {quotation.salikTollsAed.toFixed(2)}</span>
            </div>
          )}

          <div className="pt-2 border-t border-white/5 flex justify-between text-slate-300">
            <span>Subtotal (Net)</span>
            <span className="font-mono font-semibold text-white">AED {quotation.subtotalAed.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-slate-400">
            <span>UAE FTA VAT (5.0%)</span>
            <span className="font-mono text-slate-300">AED {quotation.vatAmountAed.toFixed(2)}</span>
          </div>

          {/* Grand Total */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-white uppercase tracking-wider block">
                Estimated Total Fare
              </span>
              <span className="text-[10px] text-slate-500">Includes all statutory fees & VAT</span>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200 font-mono">
                AED {quotation.totalFareAed.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cost Center & Budget Allocation ── */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3.5">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Corporate Cost Center & Billing Allocation
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Cost Center Dropdown */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Department Cost Center <span className="text-red-400">*</span>
            </label>
            <select
              value={selectedCostCenter}
              onChange={(e) => setSelectedCostCenter(e.target.value)}
              className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            >
              {CORPORATE_COST_CENTERS.map((cc) => (
                <option key={cc.code} value={cc.code}>
                  {cc.code} — {cc.name} (Cap: AED {cc.budgetCap})
                </option>
              ))}
            </select>
          </div>

          {/* Project / Client Billing Reference */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Project / Client Code (Optional)
            </label>
            <input
              type="text"
              value={selectedProjectCode}
              onChange={(e) => setSelectedProjectCode(e.target.value)}
              placeholder="e.g. PRJ-DXB-2026 or CLIENT-EMAAR"
              className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        {/* Corporate Billing Method */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Corporate Billing Method <span className="text-red-400">*</span>
          </label>
          <select
            value={selectedBillingMethod}
            onChange={(e) => setSelectedBillingMethod(e.target.value)}
            className="w-full bg-slate-800/80 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          >
            {CORPORATE_BILLING_METHODS.map((bm) => (
              <option key={bm.id} value={bm.id}>
                💳 {bm.label}
              </option>
            ))}
          </select>
        </div>

        {/* Policy Compliance & Budget Cap Status */}
        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOverBudget ? (
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            )}
            <span className={`text-xs font-medium ${isOverBudget ? 'text-amber-300' : 'text-emerald-300'}`}>
              {isOverBudget
                ? `Exceeds Department Policy Cap (AED ${effectiveCap}) · Level 2 Escalation Required`
                : `Within Department Budget Policy (Cap: AED ${effectiveCap}) · Auto-Approved`}
            </span>
          </div>

          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              isOverBudget
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            }`}
          >
            {isOverBudget ? 'ESC-REQ' : 'PRE-APPROVED'}
          </span>
        </div>
      </div>
    </div>
  );
}
