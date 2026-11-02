'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  X,
  Zap,
  Clock,
  Sliders,
  Repeat,
  Layers,
  RotateCcw,
  CheckCircle2,
  Scale,
} from 'lucide-react';
import type { DrayageAutomationConfig } from '@/lib/logistics/drayage-domain';
import { DEFAULT_DRAYAGE_AUTOMATION_CONFIG } from '@/lib/logistics/drayage-domain';

interface DrayageSuperAdminConfigModalProps {
  open: boolean;
  onClose: () => void;
  config: DrayageAutomationConfig;
  onSaved: (updated: DrayageAutomationConfig) => void;
}

export function DrayageSuperAdminConfigModal({
  open,
  onClose,
  config,
  onSaved,
}: DrayageSuperAdminConfigModalProps) {
  const [draft, setDraft] = useState<DrayageAutomationConfig>(config);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setSaveMessage(null);
      setErrorMessage(null);
    }
  }, [open, config]);

  if (!open) return null;

  const weightSum =
    Math.round(draft.weightProximityPct) +
    Math.round(draft.weightIdlenessPct) +
    Math.round(draft.weightWorkloadPct) +
    Math.round(draft.weightAvailabilityPct);

  const handleAutoBalanceWeights = () => {
    const total =
      draft.weightProximityPct +
      draft.weightIdlenessPct +
      draft.weightWorkloadPct +
      draft.weightAvailabilityPct;
    if (total <= 0) {
      setDraft((prev) => ({
        ...prev,
        weightProximityPct: 60,
        weightIdlenessPct: 25,
        weightWorkloadPct: 10,
        weightAvailabilityPct: 5,
      }));
      return;
    }
    const p = Math.round((draft.weightProximityPct / total) * 100);
    const i = Math.round((draft.weightIdlenessPct / total) * 100);
    const w = Math.round((draft.weightWorkloadPct / total) * 100);
    const a = Math.max(0, 100 - p - i - w);
    setDraft((prev) => ({
      ...prev,
      weightProximityPct: p,
      weightIdlenessPct: i,
      weightWorkloadPct: w,
      weightAvailabilityPct: a,
    }));
  };

  const handleResetDefaults = () => {
    setDraft({
      ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
      updatedAt: new Date().toISOString(),
      updatedBy: 'Super Admin',
    });
    setSaveMessage('Defaults staged — click "Save & Apply Policy" to persist.');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_automation_config',
          config: draft,
          actor: 'Super Admin',
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to save Super Admin Drayage configuration');
      }
      const savedConfig: DrayageAutomationConfig = json.automationConfig || draft;
      setDraft(savedConfig);
      onSaved(savedConfig);
      setSaveMessage('Super Admin Drayage Engine policy saved & applied live across all dispatch consoles.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '880px',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '18px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 25px 60px -15px rgba(15, 23, 42, 0.45)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.15rem 1.4rem',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#f8fafc',
            borderTopLeftRadius: '17px',
            borderTopRightRadius: '17px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <Settings size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.02rem', fontWeight: 800, color: '#ffffff' }}>
                  Super Admin Drayage &amp; Autonomous Dispatch Policy
                </span>
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Tenant Policy Store
                </span>
              </div>
              <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px' }}>
                Configure 4-Factor Telematics Weights, Auto-L2 ETC Lead Timer, Street-Turn Radius &amp; Demurrage Risk Windows
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#f8fafc',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            title="Close Configuration"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {saveMessage && (
            <div
              style={{
                padding: '0.7rem 0.95rem',
                borderRadius: '10px',
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                color: '#065f46',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <CheckCircle2 size={16} />
              <span>{saveMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                padding: '0.7rem 0.95rem',
                borderRadius: '10px',
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Section 1: Autonomous L2 Dispatch & ETC Pre-Assignment Timer */}
          <div
            style={{
              padding: '1rem 1.1rem',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Clock size={18} style={{ color: '#0284c7' }} />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                    1. Autonomous L2 Dispatch &amp; Offloading ETC Lead-Time Threshold
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                    Controls when Placed-at-Ramp containers automatically trigger L2 Empty Return &amp; pre-assign the nearest tractor
                  </div>
                </div>
              </div>

              {/* Mode Toggle */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: '999px',
                  padding: '3px',
                  background: '#e2e8f0',
                  border: '1px solid #cbd5e1',
                }}
              >
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, autoL2DispatchEnabled: false }))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '999px',
                    border: 'none',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    background: !draft.autoL2DispatchEnabled ? '#0f172a' : 'transparent',
                    color: !draft.autoL2DispatchEnabled ? '#ffffff' : '#475569',
                  }}
                >
                  Manual L2
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, autoL2DispatchEnabled: true }))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '999px',
                    border: 'none',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    background: draft.autoL2DispatchEnabled ? '#059669' : 'transparent',
                    color: draft.autoL2DispatchEnabled ? '#ffffff' : '#475569',
                  }}
                >
                  ⚡ Auto-L2 @ T-{draft.thresholdMinutes}m
                </button>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '0.9rem',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  Quick Lead-Time Presets (Before Offloading ETC Expires):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {[10, 15, 20, 30, 45, 60].map((mins) => {
                    const active = draft.thresholdMinutes === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, thresholdMinutes: mins }))}
                        style={{
                          padding: '5px 11px',
                          borderRadius: '8px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          background: active ? '#0284c7' : '#ffffff',
                          color: active ? '#ffffff' : '#0f172a',
                          border: active ? '1px solid #0284c7' : '1px solid #cbd5e1',
                        }}
                      >
                        T-{mins}m
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '0.35rem',
                  }}
                >
                  Custom Threshold (5 – 180 minutes):
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={draft.thresholdMinutes}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        thresholdMinutes: Math.max(5, Math.min(180, Number(e.target.value) || 5)),
                      }))
                    }
                    style={{
                      width: '90px',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      border: '1px solid #94a3b8',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                      color: '#0f172a',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
                    minutes before ETC expiry
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: 4-Factor Telematics Asset Scoring Weights */}
          <div
            style={{
              padding: '1rem 1.1rem',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Sliders size={18} style={{ color: '#4f46e5' }} />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                    2. 4-Factor Telematics Asset Scoring Weights (Container Pickup &amp; Rescue)
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                    Ranks logged-in tractors for L1 Port Pickup, L2 Ramp Retrieval, and PCS Slot Rescue Swaps
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    background: weightSum === 100 ? '#dcfce7' : '#fef3c7',
                    color: weightSum === 100 ? '#166534' : '#92400e',
                    border: weightSum === 100 ? '1px solid #86efac' : '1px solid #fcd34d',
                  }}
                >
                  Total: {weightSum}% {weightSum === 100 ? '✓ Balanced' : '(Auto-normalized on save)'}
                </span>
                {weightSum !== 100 && (
                  <button
                    type="button"
                    onClick={handleAutoBalanceWeights}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: '#4f46e5',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Normalize to 100%
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
                gap: '0.75rem',
              }}
            >
              {[
                {
                  key: 'weightProximityPct' as const,
                  label: 'GPS Proximity to Ramp/Port',
                  desc: 'Haversine distance to pickup terminal or warehouse ramp',
                  color: '#0284c7',
                },
                {
                  key: 'weightIdlenessPct' as const,
                  label: 'Tractor Idle Queue (FIFO)',
                  desc: 'Prioritizes longest-waiting available prime mover',
                  color: '#7c3aed',
                },
                {
                  key: 'weightWorkloadPct' as const,
                  label: 'Driver Shift Workload',
                  desc: 'Balances daily completed trips & RTA driving hours',
                  color: '#059669',
                },
                {
                  key: 'weightAvailabilityPct' as const,
                  label: 'Fuel & Chassis Readiness',
                  desc: 'Fuel level (>50%) and zero maintenance alerts',
                  color: '#d97706',
                },
              ].map((item) => (
                <div
                  key={item.key}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0f172a' }}>{item.label}</span>
                    <span style={{ fontSize: '0.86rem', fontWeight: 900, color: item.color }}>
                      {draft[item.key]}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.5rem', minHeight: '28px' }}>
                    {item.desc}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={draft[item.key]}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [item.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        }))
                      }
                      style={{ flex: 1, accentColor: item.color, cursor: 'pointer' }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft[item.key]}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [item.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        }))
                      }
                      style={{
                        width: '54px',
                        padding: '3px 6px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        textAlign: 'center',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Automated Street-Turn (Import-to-Export) Matchmaker */}
          <div
            style={{
              padding: '1rem 1.1rem',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.8rem' }}>
              <Repeat size={18} style={{ color: '#059669' }} />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                  3. Automated Street-Turn (Import-to-Export) Matchmaker Radius &amp; Carrier Policy
                </div>
                <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                  Triangulates L1 Placed-at-Ramp / L2 Empty containers directly with nearby Export L1 bookings
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.9rem',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  Maximum Street-Turn Search Radius (Haversine km):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                  {[10, 15, 20, 25, 35, 50].map((km) => {
                    const active = draft.streetTurnRadiusKm === km;
                    return (
                      <button
                        key={km}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, streetTurnRadiusKm: km }))}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '8px',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          background: active ? '#059669' : '#ffffff',
                          color: active ? '#ffffff' : '#0f172a',
                          border: active ? '1px solid #059669' : '1px solid #cbd5e1',
                        }}
                      >
                        ≤ {km} km
                      </button>
                    );
                  })}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.streetTurnRadiusKm}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        streetTurnRadiusKm: Math.max(1, Math.min(100, Number(e.target.value) || 15)),
                      }))
                    }
                    style={{
                      width: '68px',
                      padding: '5px 8px',
                      borderRadius: '8px',
                      border: '1px solid #94a3b8',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  Shipping Line / Box Owner Matching Rule:
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, streetTurnStrictCarrierMatch: true }))}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: '8px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      background: draft.streetTurnStrictCarrierMatch ? '#0f172a' : '#ffffff',
                      color: draft.streetTurnStrictCarrierMatch ? '#ffffff' : '#334155',
                      border: draft.streetTurnStrictCarrierMatch ? '1px solid #0f172a' : '1px solid #cbd5e1',
                    }}
                  >
                    Strict Same Carrier (MSC→MSC)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, streetTurnStrictCarrierMatch: false }))}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: '8px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      background: !draft.streetTurnStrictCarrierMatch ? '#0284c7' : '#ffffff',
                      color: !draft.streetTurnStrictCarrierMatch ? '#ffffff' : '#334155',
                      border: !draft.streetTurnStrictCarrierMatch ? '1px solid #0284c7' : '1px solid #cbd5e1',
                    }}
                  >
                    Flexible Grey-Box Pool
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Dual-20FT Bogie Pairing & Demurrage/Detention Risk Radar */}
          <div
            style={{
              padding: '1rem 1.1rem',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.8rem' }}>
              <Layers size={18} style={{ color: '#d97706' }} />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                  4. Dual-20FT Bogie Optimizer &amp; Demurrage/Detention Risk Escalation
                </div>
                <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                  Configures 2x20FT bogie time-window pairing, UAE RTA gross weight cap, and CRITICAL penalty alert horizon
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.85rem',
              }}
            >
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                }}
              >
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Dual-20FT Bogie Slot Window (Hours)
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.45rem' }}>
                  Max port slot gap to pair two 20FT boxes on one 40FT Bogie chassis
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {[1, 2, 3, 4].map((hr) => (
                    <button
                      key={hr}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, bogieWindowHours: hr }))}
                      style={{
                        padding: '4px 9px',
                        borderRadius: '6px',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: draft.bogieWindowHours === hr ? '#7c3aed' : '#f1f5f9',
                        color: draft.bogieWindowHours === hr ? '#ffffff' : '#0f172a',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      {hr}h
                    </button>
                  ))}
                  <input
                    type="number"
                    min={0.5}
                    max={12}
                    step={0.5}
                    value={draft.bogieWindowHours}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        bogieWindowHours: Math.max(0.5, Math.min(12, Number(e.target.value) || 2)),
                      }))
                    }
                    style={{
                      width: '58px',
                      padding: '4px 6px',
                      borderRadius: '6px',
                      border: '1px solid #94a3b8',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                }}
              >
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Bogie Max Combined Payload (kg)
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.45rem' }}>
                  UAE RTA legal axle payload cap for 2x20FT tandem bogie dispatch
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Scale size={15} style={{ color: '#475569' }} />
                  <input
                    type="number"
                    min={10000}
                    max={60000}
                    step={1000}
                    value={draft.bogieMaxPayloadKg}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        bogieMaxPayloadKg: Math.max(10000, Math.min(60000, Number(e.target.value) || 36000)),
                      }))
                    }
                    style={{
                      width: '110px',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid #94a3b8',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  />
                  <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#475569' }}>kg gross</span>
                </div>
              </div>

              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                }}
              >
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
                  Demurrage / Detention CRITICAL Window
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.45rem' }}>
                  Auto-escalates job priority to URGENT when Free Time is below threshold
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {[12, 24, 36, 48].map((hr) => (
                    <button
                      key={hr}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, criticalRiskWindowHours: hr }))}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: draft.criticalRiskWindowHours === hr ? '#dc2626' : '#f1f5f9',
                        color: draft.criticalRiskWindowHours === hr ? '#ffffff' : '#0f172a',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      &lt;{hr}h
                    </button>
                  ))}
                  <input
                    type="number"
                    min={4}
                    max={120}
                    value={draft.criticalRiskWindowHours}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        criticalRiskWindowHours: Math.max(4, Math.min(120, Number(e.target.value) || 24)),
                      }))
                    }
                    style={{
                      width: '56px',
                      padding: '4px 6px',
                      borderRadius: '6px',
                      border: '1px solid #94a3b8',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '0.95rem 1.4rem',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            borderBottomLeftRadius: '17px',
            borderBottomRightRadius: '17px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={handleResetDefaults}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={14} /> Reset Recommended Defaults
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.52rem 1rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: saving ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
              }}
            >
              <Zap size={15} />
              {saving ? 'Saving Policy...' : 'Save & Apply Policy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
