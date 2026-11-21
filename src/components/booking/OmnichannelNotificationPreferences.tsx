'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, Smartphone, Mail, Bell, Check, Sparkles } from 'lucide-react';
import {
  buildWhatsAppNotification,
  buildSmsNotification,
  NotificationChannel,
} from '@/lib/omnichannel-communication';

interface OmnichannelNotificationPreferencesProps {
  serviceType: string;
  vehicleCategory?: string;
  pickupLocation?: string;
  destinationLocation?: string;
  totalFareAed?: number;
  requestorName?: string;
  phone?: string;
  email?: string;
  onChange: (channels: NotificationChannel[], contactPhone: string) => void;
}

export function OmnichannelNotificationPreferences({
  serviceType,
  vehicleCategory,
  pickupLocation,
  destinationLocation,
  totalFareAed = 0,
  requestorName = 'Passenger',
  phone = '+971 50 123 4567',
  email = 'passenger@company.ae',
  onChange,
}: OmnichannelNotificationPreferencesProps) {
  const [selectedChannels, setSelectedChannels] = useState<NotificationChannel[]>([
    'WHATSAPP',
    'SMS',
    'EMAIL',
    'IN_APP',
  ]);
  const [contactPhone, setContactPhone] = useState(phone);
  const [previewTab, setPreviewTab] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');

  const toggleChannel = (channel: NotificationChannel) => {
    let updated: NotificationChannel[];
    if (selectedChannels.includes(channel)) {
      updated = selectedChannels.filter((c) => c !== channel);
    } else {
      updated = [...selectedChannels, channel];
    }
    setSelectedChannels(updated);
    onChange(updated, contactPhone);
  };

  const handlePhoneChange = (val: string) => {
    setContactPhone(val);
    onChange(selectedChannels, val);
  };

  const waPreview = buildWhatsAppNotification(
    'DRIVER_ASSIGNED',
    {
      bookingRef: 'FLT-DXB-9842',
      requestorName,
      serviceType,
      vehicleCategory,
      vehicleModel: 'Lexus ES300h Executive',
      vehiclePlate: 'DXB A 10293',
      driverName: 'Ahmed Al-Sayed',
      driverPhone: '+971 50 998 8776',
      pickupLocation: pickupLocation || 'Dubai Airport T3',
      destinationLocation: destinationLocation || 'Burj Khalifa, Downtown',
      totalFareAed,
    },
    contactPhone
  );

  const smsPreview = buildSmsNotification(
    'DRIVER_ASSIGNED',
    {
      bookingRef: 'FLT-DXB-9842',
      requestorName,
      serviceType,
      driverName: 'Ahmed',
      vehiclePlate: 'DXB 10293',
      pickupLocation: pickupLocation || 'Dubai Airport T3',
      totalFareAed,
    },
    contactPhone
  );

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-teal-400" />
          <span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider">
            Omnichannel Passenger Alerts & WhatsApp Notifications
          </span>
        </div>
        <span className="text-[10px] text-teal-300 font-semibold px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20">
          Live Dispatch Sync
        </span>
      </div>

      {/* Channel Toggles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* WhatsApp */}
        <button
          type="button"
          onClick={() => toggleChannel('WHATSAPP')}
          className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
            selectedChannels.includes('WHATSAPP')
              ? 'bg-emerald-950/40 border-emerald-500 text-[var(--text-main)]'
              : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-muted)]'
          }`}
        >
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
              selectedChannels.includes('WHATSAPP') ? 'bg-emerald-500 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
            }`}
          >
            📱
          </div>
          <div>
            <p className="text-xs font-bold">WhatsApp</p>
            <p className="text-[10px] text-[var(--text-muted)]">Interactive</p>
          </div>
        </button>

        {/* SMS */}
        <button
          type="button"
          onClick={() => toggleChannel('SMS')}
          className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
            selectedChannels.includes('SMS')
              ? 'bg-blue-950/40 border-blue-500 text-[var(--text-main)]'
              : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-muted)]'
          }`}
        >
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
              selectedChannels.includes('SMS') ? 'bg-blue-500 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
            }`}
          >
            💬
          </div>
          <div>
            <p className="text-xs font-bold">SMS</p>
            <p className="text-[10px] text-[var(--text-muted)]">Direct Cellular</p>
          </div>
        </button>

        {/* Email */}
        <button
          type="button"
          onClick={() => toggleChannel('EMAIL')}
          className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
            selectedChannels.includes('EMAIL')
              ? 'bg-violet-950/40 border-violet-500 text-[var(--text-main)]'
              : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-muted)]'
          }`}
        >
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
              selectedChannels.includes('EMAIL') ? 'bg-violet-500 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
            }`}
          >
            📧
          </div>
          <div>
            <p className="text-xs font-bold">Email</p>
            <p className="text-[10px] text-[var(--text-muted)]">Tax Invoice / .ics</p>
          </div>
        </button>

        {/* In-App */}
        <button
          type="button"
          onClick={() => toggleChannel('IN_APP')}
          className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
            selectedChannels.includes('IN_APP')
              ? 'bg-amber-950/40 border-amber-500 text-[var(--text-main)]'
              : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-muted)]'
          }`}
        >
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
              selectedChannels.includes('IN_APP') ? 'bg-amber-500 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
            }`}
          >
            🔔
          </div>
          <div>
            <p className="text-xs font-bold">In-App</p>
            <p className="text-[10px] text-[var(--text-muted)]">Push Drawer</p>
          </div>
        </button>
      </div>

      {/* Mobile Input & Preview Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Passenger WhatsApp / Mobile Number <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={contactPhone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="+971 50 123 4567"
            className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-teal-500/50"
          />
          <p className="text-[11px] text-[var(--text-faint)] mt-1">
            Passenger receives live driver GPS tracking and arrival alerts via selected channels.
          </p>
        </div>

        {/* Live Card Preview */}
        <div className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Live Preview:
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPreviewTab('WHATSAPP')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  previewTab === 'WHATSAPP' ? 'bg-emerald-600 text-white' : 'text-[var(--text-faint)]'
                }`}
              >
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('SMS')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  previewTab === 'SMS' ? 'bg-blue-600 text-white' : 'text-[var(--text-faint)]'
                }`}
              >
                SMS
              </button>
            </div>
          </div>

          {previewTab === 'WHATSAPP' ? (
            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-3 text-xs space-y-2 text-[var(--text-main)]">
              <p className="font-bold text-emerald-400">{waPreview.header}</p>
              <p className="text-[11px] whitespace-pre-line leading-relaxed text-[var(--text-muted)]">
                {waPreview.body}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {waPreview.actionButtons.map((btn, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-medium px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
                  >
                    {btn.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-blue-950/20 border border-blue-500/20 rounded-lg p-3 text-xs space-y-1 text-[var(--text-main)]">
              <p className="font-mono text-[11px] text-blue-300 leading-relaxed">
                {smsPreview.messageText}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
