'use client';
export const dynamic = 'force-dynamic';
import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  UserCheck,
  CarFront,
  Truck,
  MapPin,
  Plane,
  ShieldCheck,
  FileCheck,
  Calendar,
  Clock,
  Sparkles,
  Navigation,
  Gauge,
  DollarSign,
  CheckCircle2,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { InteractiveRoutePicker } from '@/components/booking/InteractiveRoutePicker';
import { AssetAvailabilitySelector } from '@/components/booking/AssetAvailabilitySelector';
import { InstantPricingCostCenter } from '@/components/booking/InstantPricingCostCenter';
import { OmnichannelNotificationPreferences } from '@/components/booking/OmnichannelNotificationPreferences';
import { DigitalKycUaePass } from '@/components/booking/DigitalKycUaePass';
import { MultiStopRoutePicker } from '@/components/booking/MultiStopRoutePicker';
import { DigitalEbolScanner } from '@/components/booking/DigitalEbolScanner';
import { RecurringSchedulePicker } from '@/components/booking/RecurringSchedulePicker';
import { DriverHandoverEpod } from '@/components/booking/DriverHandoverEpod';
import { ColdChainTelemetryGraph } from '@/components/booking/ColdChainTelemetryGraph';
import { BulkConsignmentUploader } from '@/components/booking/BulkConsignmentUploader';

export function getServiceVectorIcon(type: string, className = 'w-5 h-5 text-amber-300') {
  switch (type) {
    case 'RENTAL':
      return <CarFront className={className} />;
    case 'LEASING':
      return <FileCheck className={className} />;
    case 'STAFF_TRANSPORT':
      return <CarFront className={className} />;
    case 'EXECUTIVE':
      return <Sparkles className={className} />;
    case 'LOGISTICS':
      return <Truck className={className} />;
    case 'SCHOOL_BUS':
      return <ShieldCheck className={className} />;
    default:
      return <Sparkles className={className} />;
  }
}

export function getSectionVectorIcon(title: string, className = 'w-4 h-4 text-amber-300') {
  const t = title.toLowerCase();
  if (t.includes('requestor') || t.includes('client') || t.includes('passenger')) {
    return <UserCheck className={className} />;
  }
  if (t.includes('vehicle') || t.includes('car') || t.includes('model')) {
    return <CarFront className={className} />;
  }
  if (t.includes('schedule') || t.includes('time') || t.includes('shift') || t.includes('duration')) {
    return <Clock className={className} />;
  }
  if (t.includes('location') || t.includes('route') || t.includes('stop') || t.includes('destination')) {
    return <MapPin className={className} />;
  }
  if (t.includes('cargo') || t.includes('freight') || t.includes('consignment')) {
    return <Truck className={className} />;
  }
  if (t.includes('flight') || t.includes('meet')) {
    return <Plane className={className} />;
  }
  if (t.includes('student') || t.includes('school') || t.includes('security') || t.includes('insurance')) {
    return <ShieldCheck className={className} />;
  }
  if (t.includes('lease') || t.includes('contract') || t.includes('terms')) {
    return <FileCheck className={className} />;
  }
  return <Sparkles className={className} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service type card definitions (Step 1)
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_MODULE_MAP: Record<string, string> = {
  RENTAL:          'rental',
  LEASING:         'leasing',
  STAFF_TRANSPORT: 'bus-ops',
  EXECUTIVE:       'dispatch',
  LOGISTICS:       'logistics',
  SCHOOL_BUS:      'school-bus',
};

const SERVICE_CARDS = [
  {
    type: 'RENTAL',
    title: 'Rent-a-Car',
    desc: 'Short-term vehicle rental for flexible needs',
    icon: '🚗',
    gradient: 'from-emerald-600 to-teal-700',
    badge: 'RENTAL',
    accent: 'emerald',
  },
  {
    type: 'LEASING',
    title: 'Vehicle Leasing',
    desc: 'Long-term fleet lease contracts for corporates',
    icon: '📋',
    gradient: 'from-blue-600 to-indigo-700',
    badge: 'LEASING',
    accent: 'blue',
  },
  {
    type: 'STAFF_TRANSPORT',
    title: 'Staff Transport',
    desc: 'Scheduled shuttle and bus service registration',
    icon: '🚌',
    gradient: 'from-purple-600 to-violet-700',
    badge: 'SHUTTLE',
    accent: 'purple',
  },
  {
    type: 'EXECUTIVE',
    title: 'Executive Vehicle',
    desc: 'Premium chauffeur-driven vehicles for VIP travel',
    icon: '⭐',
    gradient: 'from-amber-600 to-yellow-700',
    badge: 'PREMIUM',
    accent: 'amber',
  },
  {
    type: 'LOGISTICS',
    title: 'Logistics Trip',
    desc: 'Freight dispatch with multi-stop route planning',
    icon: '🚛',
    gradient: 'from-orange-600 to-amber-700',
    badge: 'LOGISTICS',
    accent: 'orange',
  },
  {
    type: 'SCHOOL_BUS',
    title: 'School Bus',
    desc: 'Student transportation and route enrollment',
    icon: '🏫',
    gradient: 'from-yellow-500 to-orange-600',
    badge: 'SCHOOL',
    accent: 'yellow',
  },
] as const;

type ServiceType = typeof SERVICE_CARDS[number]['type'];

// ─────────────────────────────────────────────────────────────────────────────
// Field schema — one config object drives all rendering
// ─────────────────────────────────────────────────────────────────────────────

type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'date' | 'time'
  | 'select' | 'textarea' | 'toggle' | 'multicheck';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  half?: boolean;           // render at half-width in a 2-col grid
  unit?: string;            // suffix label e.g. "months", "AED"
  showIf?: (form: FormData) => boolean;
}

interface SectionDef {
  title: string;
  icon: string;
  fields: FieldDef[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-service form schemas
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMAS: Record<ServiceType, SectionDef[]> = {

  // ── RENTAL ────────────────────────────────────────────────────────────────
  RENTAL: [
    {
      title: 'Requestor Information',
      icon: '👤',
      fields: [
        { key: 'requestorName',  label: 'Full Name',         type: 'text',  placeholder: 'Your full name',         required: true,  half: true  },
        { key: 'requestorEmail', label: 'Email Address',     type: 'email', placeholder: 'you@company.com',         required: true,  half: true  },
        { key: 'phone',          label: 'Mobile Number',     type: 'tel',   placeholder: '+971 50 000 0000',                          half: true  },
        { key: 'emiratesId',     label: 'Emirates ID / Passport', type: 'text', placeholder: '784-XXXX-XXXXXXX-X',                   half: true  },
        { key: 'licenseNo',      label: 'Driving License No.',type: 'text', placeholder: 'License number',                            half: true  },
        { key: 'licenseExpiry',  label: 'License Expiry',   type: 'date',                                                             half: true  },
      ],
    },
    {
      title: 'Vehicle Requirements',
      icon: '🚗',
      fields: [
        { key: 'vehicleCategory', label: 'Vehicle Category', type: 'select', required: true, half: true,
          options: ['Economy', 'Compact', 'Mid-Size', 'Full-Size', 'SUV', '4x4', 'Van', 'Pickup Truck'] },
        { key: 'transmission',    label: 'Transmission',     type: 'select', half: true,
          options: ['Automatic', 'Manual', 'No Preference'] },
        { key: 'fuelType',        label: 'Fuel Type',        type: 'select', half: true,
          options: ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'No Preference'] },
        { key: 'additionalDriver',label: 'Additional Driver', type: 'toggle',
          hint: 'Add a second authorized driver (extra fee may apply)' },
      ],
    },
    {
      title: 'Rental Period',
      icon: '📅',
      fields: [
        { key: 'startDate',     label: 'Pickup Date',    type: 'date', required: true, half: true },
        { key: 'pickupTime',    label: 'Pickup Time',    type: 'time',                  half: true },
        { key: 'endDate',       label: 'Return Date',    type: 'date',                  half: true },
        { key: 'returnTime',    label: 'Return Time',    type: 'time',                  half: true },
      ],
    },
    {
      title: 'Pickup & Return Location',
      icon: '📍',
      fields: [
        { key: 'origin',          label: 'Pickup Location', type: 'text', placeholder: 'Branch, hotel, or address', required: true },
        { key: 'sameReturnLoc',   label: 'Return to same location', type: 'toggle',
          hint: 'Enable to return the vehicle to the same pickup point' },
        { key: 'destination',     label: 'Return Location', type: 'text', placeholder: 'Different return address',
          showIf: (f) => !f.sameReturnLoc },
      ],
    },
    {
      title: 'Notes & Special Requirements',
      icon: '📝',
      fields: [
        { key: 'notes', label: 'Additional Requirements', type: 'textarea',
          placeholder: 'Child seat, GPS unit, baby seat, insurance type preference…' },
      ],
    },
  ],

  // ── LEASING ───────────────────────────────────────────────────────────────
  LEASING: [
    {
      title: 'Company & Contact',
      icon: '🏢',
      fields: [
        { key: 'companyName',    label: 'Company / Organisation', type: 'text',  placeholder: 'Legal company name', required: true, half: true },
        { key: 'requestorName',  label: 'Contact Person',         type: 'text',  placeholder: 'Your full name',     required: true, half: true },
        { key: 'requestorEmail', label: 'Email Address',          type: 'email', placeholder: 'contact@company.com',required: true, half: true },
        { key: 'phone',          label: 'Direct Phone',           type: 'tel',   placeholder: '+971 4 000 0000',                    half: true },
        { key: 'tradeNo',        label: 'Trade License No.',      type: 'text',  placeholder: 'CN-XXXXXXX',                         half: true },
        { key: 'vatNo',          label: 'TRN / VAT No.',          type: 'text',  placeholder: '100XXXXXXXXX',                       half: true },
      ],
    },
    {
      title: 'Fleet Requirements',
      icon: '🚙',
      fields: [
        { key: 'vehicleCategory', label: 'Vehicle Type',       type: 'select', required: true, half: true,
          options: ['Compact Sedan', 'Mid-Size Sedan', 'SUV', 'Van (7-seater)', 'Mini-Bus', 'Bus', 'Pickup Truck', 'Mixed Fleet'] },
        { key: 'quantity',        label: 'Number of Vehicles', type: 'number', placeholder: '1', required: true, half: true, unit: 'vehicles' },
        { key: 'leaseDuration',   label: 'Lease Duration',     type: 'select', required: true, half: true,
          options: ['12 months', '18 months', '24 months', '36 months', '48 months', '60 months'] },
        { key: 'startDate',       label: 'Requested Start Date',type: 'date',  required: true, half: true },
        { key: 'monthlyBudget',   label: 'Monthly Budget (AED)',type: 'number', placeholder: '3000', half: true, unit: 'AED/mo' },
        { key: 'mileagePerMonth', label: 'Monthly Mileage',    type: 'select', half: true,
          options: ['Up to 2,000 km', '2,001–3,500 km', '3,501–5,000 km', '5,001–8,000 km', 'Unlimited'] },
      ],
    },
    {
      title: 'Vehicle Preferences',
      icon: '⚙️',
      fields: [
        { key: 'preferredBrand',  label: 'Preferred Brand(s)',  type: 'text',   placeholder: 'Toyota, Honda, Hyundai…', half: true },
        { key: 'fuelType',        label: 'Fuel Type',           type: 'select', half: true,
          options: ['Petrol', 'Hybrid', 'Electric', 'Diesel', 'No Preference'] },
        { key: 'transmission',    label: 'Transmission',        type: 'select', half: true,
          options: ['Automatic', 'Manual', 'No Preference'] },
        { key: 'color',           label: 'Colour Preference',   type: 'text',   placeholder: 'White, Silver, No preference', half: true },
      ],
    },
    {
      title: 'Contract Inclusions',
      icon: '✅',
      fields: [
        { key: 'insuranceIncluded',    label: 'Comprehensive Insurance', type: 'toggle',
          hint: 'Include third-party and comprehensive insurance in monthly rate' },
        { key: 'maintenanceIncluded',  label: 'Full Maintenance',        type: 'toggle',
          hint: 'Scheduled service, tyres, and repairs included' },
        { key: 'salikIncluded',        label: 'Salik / Tolls',           type: 'toggle',
          hint: 'Include Salik toll charges in contract' },
        { key: 'trafficFineIncluded',  label: 'Traffic Fine Management', type: 'toggle',
          hint: 'Centralized traffic fine handling through leasing company' },
      ],
    },
    {
      title: 'Notes & Requirements',
      icon: '📝',
      fields: [
        { key: 'notes', label: 'Additional Notes', type: 'textarea',
          placeholder: 'Delivery location, specific configurations, corporate rate requirements…' },
      ],
    },
  ],

  // ── STAFF_TRANSPORT ───────────────────────────────────────────────────────
  STAFF_TRANSPORT: [
    {
      title: 'Employee Information',
      icon: '👤',
      fields: [
        { key: 'requestorName',  label: 'Employee Name',    type: 'text',  placeholder: 'Full name',         required: true, half: true },
        { key: 'requestorEmail', label: 'Work Email',       type: 'email', placeholder: 'name@company.com',  required: true, half: true },
        { key: 'phone',          label: 'Mobile Number',    type: 'tel',   placeholder: '+971 50 000 0000',                  half: true },
        { key: 'department',     label: 'Department',       type: 'text',  placeholder: 'IT, Finance, HR…',                  half: true },
        { key: 'employeeId',     label: 'Employee ID',      type: 'text',  placeholder: 'EMP-XXXXX',                          half: true },
        { key: 'shiftType',      label: 'Shift Type',       type: 'select', half: true,
          options: ['Morning (06:00–14:00)', 'Afternoon (14:00–22:00)', 'Night (22:00–06:00)', 'Standard (09:00–18:00)', 'Split Shift'] },
      ],
    },
    {
      title: 'Route Details',
      icon: '📍',
      fields: [
        { key: 'origin',      label: 'Home Pickup Area / Zone', type: 'text', placeholder: 'Residential area, landmark or street', required: true },
        { key: 'destination', label: 'Office / Workplace',      type: 'text', placeholder: 'Office building, site, facility',      required: true },
      ],
    },
    {
      title: 'Schedule',
      icon: '🗓️',
      fields: [
        { key: 'workDays',       label: 'Working Days',        type: 'select', required: true, half: true,
          options: ['Sunday–Thursday', 'Monday–Friday', 'Monday–Saturday', 'Sunday–Saturday', 'Custom'] },
        { key: 'pickupTime',     label: 'Morning Pickup Time', type: 'time', required: true, half: true },
        { key: 'returnTime',     label: 'Evening Return Time', type: 'time',                  half: true },
        { key: 'startDate',      label: 'Service Start Date',  type: 'date', required: true,  half: true },
        { key: 'endDate',        label: 'Service End Date',    type: 'date',
          hint: 'Leave blank for open-ended / indefinite service' },
      ],
    },
    {
      title: 'Additional Requirements',
      icon: '♿',
      fields: [
        { key: 'accessibilityNeeds', label: 'Accessibility / Special Needs', type: 'select', half: true,
          options: ['None', 'Wheelchair Accessible', 'Extra Leg Room', 'Hearing Impaired', 'Other'] },
        { key: 'genderPreference',   label: 'Driver Gender Preference',     type: 'select', half: true,
          options: ['No Preference', 'Male Driver', 'Female Driver'] },
        { key: 'notes', label: 'Additional Notes', type: 'textarea',
          placeholder: 'Exact pickup point, gate number, building entry instructions…' },
      ],
    },
  ],

  // ── EXECUTIVE ─────────────────────────────────────────────────────────────
  EXECUTIVE: [
    {
      title: 'Requestor & Authorization',
      icon: '👤',
      fields: [
        { key: 'requestorName',  label: 'Booking Contact Name', type: 'text',  placeholder: 'Your full name',       required: true, half: true },
        { key: 'requestorEmail', label: 'Email Address',         type: 'email', placeholder: 'contact@company.com',  required: true, half: true },
        { key: 'phone',          label: 'Contact Number',        type: 'tel',   placeholder: '+971 50 000 0000',                     half: true },
        { key: 'department',     label: 'Department / Cost Center', type: 'text', placeholder: 'C-Suite, Exec Office…',               half: true },
      ],
    },
    {
      title: 'Passenger Details',
      icon: '⭐',
      fields: [
        { key: 'passengerName',  label: 'Passenger / Executive Name', type: 'text', placeholder: 'Name of the traveller',
          hint: 'Leave blank if same as requestor', half: true },
        { key: 'vipLevel',       label: 'VIP Level',                  type: 'select', half: true,
          options: ['C-Suite / Board', 'Senior Management', 'Government Official', 'Client / Guest', 'Standard Executive'] },
        { key: 'paxCount',       label: 'No. of Passengers',          type: 'number', placeholder: '1', half: true, unit: 'pax' },
        { key: 'chauffeurRequired', label: 'Dedicated Chauffeur',     type: 'toggle',
          hint: 'Assign a dedicated chauffeur for this booking' },
      ],
    },
    {
      title: 'Vehicle & Trip Type',
      icon: '🚙',
      fields: [
        { key: 'vehicleCategory', label: 'Vehicle Class',   type: 'select', required: true, half: true,
          options: ['Business Sedan', 'Luxury Sedan', 'Luxury SUV', 'Executive Van (MPV)', 'Stretch Limousine', 'SUV Convoy'] },
        { key: 'tripType',        label: 'Trip Type',       type: 'select', required: true, half: true,
          options: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)', 'City Transfer', 'Event / Function', 'Road Show', 'Full Day', 'Multi-Day'] },
      ],
    },
    {
      title: 'Outbound Journey',
      icon: '🛫',
      fields: [
        { key: 'origin',      label: 'Pickup Location',  type: 'text', placeholder: 'Hotel, office, terminal, gate', required: true },
        { key: 'destination', label: 'Drop-off Location',type: 'text', placeholder: 'Destination address or terminal', required: true },
        { key: 'startDate',   label: 'Date',             type: 'date', required: true, half: true },
        { key: 'pickupTime',  label: 'Pickup Time',      type: 'time', required: true, half: true },
        { key: 'flightNo',    label: 'Flight Number',    type: 'text', placeholder: 'EK001', half: true,
          hint: 'For airport transfers — enables flight tracking' },
        { key: 'terminal',    label: 'Terminal',         type: 'select', half: true,
          options: ['—', 'Terminal 1 (DXB)', 'Terminal 2 (DXB)', 'Terminal 3 (DXB)', 'AUH Terminal A', 'AUH Terminal B', 'SHJ Airport', 'Other'] },
      ],
    },
    {
      title: 'Return Journey',
      icon: '🛬',
      fields: [
        { key: 'returnRequired', label: 'Return Transfer Required', type: 'toggle',
          hint: 'Enable if a return trip is needed' },
        { key: 'endDate',        label: 'Return Date',   type: 'date', half: true,
          showIf: (f) => !!f.returnRequired },
        { key: 'returnTime',     label: 'Return Time',   type: 'time', half: true,
          showIf: (f) => !!f.returnRequired },
        { key: 'returnFrom',     label: 'Return Pickup', type: 'text', placeholder: 'Pickup for return',
          showIf: (f) => !!f.returnRequired },
      ],
    },
    {
      title: 'In-Vehicle Extras',
      icon: '🎁',
      fields: [
        { key: 'extras', label: 'Special Requests', type: 'select', half: true,
          options: ['None', 'Mineral Water', 'Newspapers / Magazines', 'WiFi Hotspot', 'Name Board / Signage', 'Flowers / Gifts', 'Cold Towels'] },
        { key: 'notes',  label: 'Additional Instructions', type: 'textarea',
          placeholder: 'Meet & greet instructions, dress code for driver, preferred route, protocol notes…' },
      ],
    },
  ],

  // ── LOGISTICS ─────────────────────────────────────────────────────────────
  LOGISTICS: [
    {
      title: 'Customer / Requestor',
      icon: '🏢',
      fields: [
        { key: 'companyName',    label: 'Company Name',    type: 'text',  placeholder: 'Customer company',     required: true, half: true },
        { key: 'requestorName',  label: 'Contact Person',  type: 'text',  placeholder: 'Your full name',       required: true, half: true },
        { key: 'requestorEmail', label: 'Email Address',   type: 'email', placeholder: 'logistics@company.com',required: true, half: true },
        { key: 'phone',          label: 'Contact Number',  type: 'tel',   placeholder: '+971 50 000 0000',                     half: true },
      ],
    },
    {
      title: 'Shipment Classification',
      icon: '🏷️',
      fields: [
        { key: 'shipmentType', label: 'Shipment Type', type: 'select', required: true, half: true,
          options: ['FTL – Full Truck Load', 'LTL – Less than Truck Load', 'FCL – Full Container Load', 'LCL – Less than Container Load', 'REEFER – Temperature Controlled', 'SPECIAL – Oversized / Project Cargo'],
          hint: 'Select the load type that best matches your shipment' },
        { key: 'vehicleCategory', label: 'Vehicle Type Required', type: 'select', half: true,
          options: ['Any Available', 'Small Van (< 1 ton)', 'Medium Van (1–3 ton)', 'Light Truck (3–7 ton)', 'Heavy Truck (7–20 ton)', 'Flatbed / Low-bed', 'Tanker', 'Reefer Truck'] },
        { key: 'hsCode',        label: 'HS Code (Harmonized System)', type: 'text', placeholder: 'e.g. 8471.30',
          hint: 'International commodity code — required for customs clearance',  half: true },
        { key: 'hsDescription', label: 'HS Code Description',          type: 'text', placeholder: 'e.g. Portable automatic data processing machines', half: true },
      ],
    },
    {
      title: 'Route & Schedule',
      icon: '📍',
      fields: [
        { key: 'origin',          label: 'Pickup / Origin Address',      type: 'text', placeholder: 'Warehouse or collection point', required: true },
        { key: 'destination',     label: 'Delivery / Destination Address',type: 'text', placeholder: 'Final delivery address',       required: true },
        { key: 'startDate',       label: 'Pickup Date',                  type: 'date', required: true, half: true },
        { key: 'pickupTime',      label: 'Pickup Time (Preferred)',       type: 'time',                  half: true },
        { key: 'deliveryDate',    label: 'Expected Delivery Date',        type: 'date',                  half: true },
        { key: 'deliveryTime',    label: 'Delivery Time Window',          type: 'select', half: true,
          options: ['Anytime', '06:00–10:00', '10:00–14:00', '14:00–18:00', '18:00–22:00', 'Before Noon', 'After Noon'] },
      ],
    },
    {
      title: 'Cargo Details',
      icon: '📦',
      fields: [
        { key: 'cargoType',     label: 'Cargo Type',             type: 'select', required: true, half: true,
          options: ['General Goods', 'Fragile / Breakable', 'Perishable / Cold Chain', 'Hazardous Materials', 'Heavy Machinery', 'Documents / Parcels', 'Furniture', 'E-Commerce', 'Automotive Parts', 'Electronics', 'Pharmaceuticals'] },
        { key: 'cargo',         label: 'Cargo Description',      type: 'text',   placeholder: 'Brief description of what is being transported', required: true },
        { key: 'weight',        label: 'Gross Weight',           type: 'number', placeholder: '500', half: true, unit: 'kg' },
        { key: 'cbm',           label: 'Volume (CBM)',           type: 'number', placeholder: '2.5',  half: true, unit: 'm³' },
        { key: 'dimensions',    label: 'Dimensions (L×W×H)',     type: 'text',   placeholder: '2m × 1.2m × 1.5m', half: true },
        { key: 'pallets',       label: 'No. of Pallets / Units', type: 'number', placeholder: '10',  half: true, unit: 'units' },
        { key: 'tempControlled', label: 'Temperature Controlled', type: 'toggle',
          hint: 'Cargo requires refrigeration or controlled temperature' },
        { key: 'tempRange',     label: 'Temperature Range',      type: 'text',   placeholder: '2°C – 8°C',
          showIf: (f) => !!f.tempControlled, half: true },
      ],
    },
    {
      title: 'Hazardous Materials (ADR / IMDG)',
      icon: '⚠️',
      fields: [
        { key: 'isHazmat',         label: 'Contains Dangerous Goods',     type: 'toggle',
          hint: 'Tick if shipment is classified as hazardous under ADR / IMDG regulations' },
        { key: 'unNumber',         label: 'UN Number',                    type: 'text',   placeholder: 'e.g. UN1950',
          showIf: (f) => !!f.isHazmat, half: true,
          hint: 'UN identification number for the dangerous substance' },
        { key: 'adrClass',         label: 'ADR / IMDG Class',             type: 'select', half: true,
          showIf: (f) => !!f.isHazmat,
          options: ['Class 1 – Explosives', 'Class 2 – Gases', 'Class 3 – Flammable Liquids',
                    'Class 4 – Flammable Solids', 'Class 5 – Oxidizing Substances',
                    'Class 6 – Toxic & Infectious', 'Class 7 – Radioactive',
                    'Class 8 – Corrosives', 'Class 9 – Misc. Dangerous Goods'] },
        { key: 'packingGroup',     label: 'Packing Group',                type: 'select', half: true,
          showIf: (f) => !!f.isHazmat,
          options: ['PG I – Great Danger', 'PG II – Medium Danger', 'PG III – Minor Danger', 'N/A'] },
        { key: 'hazmatDescription',label: 'Proper Shipping Name',         type: 'text',   placeholder: 'e.g. Aerosols, flammable',
          showIf: (f) => !!f.isHazmat,
          hint: 'Official technical name as per IMDG / ADR' },
        { key: 'msdsAvailable',    label: 'MSDS / SDS Document Available', type: 'toggle',
          showIf: (f) => !!f.isHazmat,
          hint: 'Material Safety Data Sheet will be provided with shipment' },
      ],
    },
    {
      title: 'Service Options',
      icon: '⚙️',
      fields: [
        { key: 'urgentDelivery',  label: 'Urgent / Priority Delivery', type: 'toggle',
          hint: 'Marked as high priority — surcharge may apply' },
        { key: 'podRequired',     label: 'Proof of Delivery (POD)',     type: 'toggle',
          hint: 'Signed delivery receipt required' },
        { key: 'insuranceReq',    label: 'Cargo Insurance Required',   type: 'toggle',
          hint: 'Request cargo insurance for this shipment' },
        { key: 'customsClearance',label: 'Customs Clearance Required', type: 'toggle',
          hint: 'Shipment requires import/export customs processing' },
      ],
    },
    {
      title: 'Notes & Special Handling',
      icon: '📝',
      fields: [
        { key: 'notes', label: 'Special Handling Instructions', type: 'textarea',
          placeholder: 'Do not stack, this side up, fragile contents, access restrictions at delivery site, loading dock required…' },
      ],
    },
  ],

  // ── SCHOOL_BUS ────────────────────────────────────────────────────────────
  SCHOOL_BUS: [
    {
      title: 'Parent / Guardian',
      icon: '👨‍👩‍👧',
      fields: [
        { key: 'requestorName',  label: 'Parent / Guardian Name', type: 'text',  placeholder: 'Full name', required: true, half: true },
        { key: 'requestorEmail', label: 'Email Address',           type: 'email', placeholder: 'parent@email.com', required: true, half: true },
        { key: 'phone',          label: 'Mobile Number',           type: 'tel',   placeholder: '+971 50 000 0000', required: true, half: true },
        { key: 'relationship',   label: 'Relationship to Student', type: 'select', half: true,
          options: ['Father', 'Mother', 'Guardian', 'Grandparent', 'Other'] },
      ],
    },
    {
      title: 'Student Information',
      icon: '👧',
      fields: [
        { key: 'studentName',  label: 'Student Full Name', type: 'text',   placeholder: 'Student full legal name', required: true, half: true },
        { key: 'studentGrade', label: 'Grade / Class',     type: 'text',   placeholder: 'Grade 5, Year 7, KG2…',                 half: true },
        { key: 'studentAge',   label: 'Student Age',       type: 'number', placeholder: '10', half: true, unit: 'years' },
        { key: 'studentId',    label: 'School ID / Emirates ID', type: 'text', placeholder: 'Student ID number', half: true },
      ],
    },
    {
      title: 'School Details',
      icon: '🏫',
      fields: [
        { key: 'destination',  label: 'School Name',         type: 'text', placeholder: 'Full school name', required: true, half: true },
        { key: 'schoolArea',   label: 'School Area / Zone',  type: 'text', placeholder: 'Al Barsha, Jumeirah, Mirdif…', half: true },
        { key: 'curriculum',   label: 'Curriculum',          type: 'select', half: true,
          options: ['UAE National', 'British (GEMS, GEMS-KHDA)', 'American', 'IB (International Baccalaureate)', 'Indian CBSE', 'Indian ICSE', 'Other'] },
      ],
    },
    {
      title: 'Pickup Route',
      icon: '📍',
      fields: [
        { key: 'origin',         label: 'Home Pickup Address',        type: 'text', placeholder: 'Villa / apartment address or landmark', required: true },
        { key: 'pickupTime',     label: 'Morning Pickup Time',        type: 'time', required: true, half: true,
          hint: 'Approximate preferred time' },
        { key: 'returnTime',     label: 'Afternoon Return Time',      type: 'time',                  half: true },
        { key: 'startDate',      label: 'Enrollment Start Date',      type: 'date', required: true, half: true },
        { key: 'endDate',        label: 'Expected End Date',          type: 'date',                  half: true,
          hint: 'End of school year or leave blank for full year' },
      ],
    },
    {
      title: 'Medical & Special Needs',
      icon: '⚕️',
      fields: [
        { key: 'medicalConditions', label: 'Medical Conditions / Allergies', type: 'textarea',
          placeholder: 'Asthma, nut allergy, diabetes, epilepsy — list any conditions the driver should know about',
          hint: 'This information is kept confidential and shared only with the assigned driver' },
        { key: 'specialNeeds',      label: 'Special Needs',                  type: 'select', half: true,
          options: ['None', 'Wheelchair Accessible', 'Extra Supervision', 'Vision Impaired', 'Hearing Impaired', 'Behavioural Support', 'Other'] },
        { key: 'epiPenOnBoard',     label: 'EpiPen / Emergency Medication',  type: 'toggle',
          hint: 'Student carries emergency medication — driver will be briefed' },
      ],
    },
    {
      title: 'Emergency Contact',
      icon: '🆘',
      fields: [
        { key: 'emergencyContact', label: 'Emergency Contact Name',   type: 'text', placeholder: 'Name of backup contact', half: true },
        { key: 'emergencyPhone',   label: 'Emergency Contact Number', type: 'tel',  placeholder: '+971 50 000 0000',       half: true },
      ],
    },
    {
      title: 'Additional Notes',
      icon: '📝',
      fields: [
        { key: 'notes', label: 'Notes for Driver / Operations', type: 'textarea',
          placeholder: 'Gate code, preferred drop point within school, alternative pickup person, holiday schedule…' },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state (union of all possible keys across all services)
// ─────────────────────────────────────────────────────────────────────────────

type FormData = Record<string, string | boolean | number>;

const EMPTY_FORM: FormData = {
  requestorName: '', requestorEmail: '', phone: '',
  emiratesId: '', licenseNo: '', licenseExpiry: '',
  vehicleCategory: '', transmission: '', fuelType: '', additionalDriver: false,
  startDate: '', endDate: '', pickupTime: '', returnTime: '',
  origin: '', destination: '', sameReturnLoc: true,
  companyName: '', tradeNo: '', vatNo: '',
  quantity: '', leaseDuration: '', monthlyBudget: '', mileagePerMonth: '',
  preferredBrand: '', color: '',
  insuranceIncluded: false, maintenanceIncluded: false,
  salikIncluded: false, trafficFineIncluded: false,
  department: '', employeeId: '', shiftType: '', workDays: '',
  returnRequired: false, accessibilityNeeds: '', genderPreference: '',
  passengerName: '', vipLevel: '', paxCount: '',
  chauffeurRequired: false, tripType: '', flightNo: '', terminal: '',
  returnFrom: '', extras: '',
  cargoType: '', cargo: '', weight: '', dimensions: '', pallets: '',
  tempControlled: false, tempRange: '', urgentDelivery: false,
  podRequired: false, insuranceReq: false, deliveryDate: '', deliveryTime: '',
  studentName: '', studentGrade: '', studentAge: '', studentId: '',
  schoolArea: '', curriculum: '', relationship: '',
  medicalConditions: '', specialNeeds: '', epiPenOnBoard: false,
  emergencyContact: '', emergencyPhone: '',
  notes: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: serialize form → booking payload
// ─────────────────────────────────────────────────────────────────────────────

function buildPayload(serviceType: ServiceType, form: FormData) {
  const ref = `${serviceType.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;

  // Core booking fields
  const core = {
    bookingRef:      ref,
    serviceType,
    requestorName:   (form.requestorName as string) || undefined,
    requestorEmail:  (form.requestorEmail as string) || undefined,
    startDate:       form.startDate ? new Date(form.startDate as string).toISOString() : new Date().toISOString(),
    endDate:         form.endDate ? new Date(form.endDate as string).toISOString() : undefined,
    vehicleCategory: (form.vehicleCategory as string) || undefined,
    status:          'PENDING',
  };

  // Serialize ALL remaining form fields into notes JSON
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (['requestorName','requestorEmail','startDate','endDate','vehicleCategory','notes'].includes(k)) continue;
    if (v !== '' && v !== false && v !== 0 && v !== undefined) meta[k] = v;
  }
  if (form.notes) meta.extraNotes = form.notes;

  return { ...core, notes: JSON.stringify(meta), _ref: ref };
}

// ─────────────────────────────────────────────────────────────────────────────
// Form field renderers
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full bg-[#181920] border border-amber-500/30 rounded-xl px-4 py-3 text-white text-sm ' +
  'placeholder-zinc-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 ' +
  'transition-all shadow-inner shadow-black/40';

const labelCls = 'block text-xs font-bold text-amber-400 uppercase tracking-wider mb-1.5';

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string | boolean | number;
  onChange: (k: string, v: string | boolean | number) => void;
}) {
  if (field.type === 'toggle') {
    return (
      <div className="flex items-start gap-3 bg-[#181920] border border-amber-500/30 rounded-xl px-4 py-3 shadow-md">
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(field.key, !value)}
          className={`relative mt-0.5 flex-shrink-0 w-10 h-6 rounded-full transition-colors ${
            value ? 'bg-gradient-to-r from-amber-400 to-yellow-500 shadow-md shadow-amber-500/30' : 'bg-zinc-800'
          }`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-black shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
        <div>
          <p className="text-sm font-bold text-white">{field.label}</p>
          {field.hint && <p className="text-xs text-amber-200/70 mt-0.5">{field.hint}</p>}
        </div>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className={labelCls}>{field.label}{field.required && <span className="text-amber-400 ml-0.5">*</span>}</label>
        <select
          value={value as string}
          onChange={e => onChange(field.key, e.target.value)}
          required={field.required}
          className={inputCls}
        >
          <option value="" className="bg-[#121318] text-zinc-400">— Select —</option>
          {field.options?.map(o => <option key={o} value={o} className="bg-[#121318] text-white">{o}</option>)}
        </select>
        {field.hint && <p className="text-xs text-amber-200/70 mt-1">{field.hint}</p>}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        <label className={labelCls}>{field.label}</label>
        <textarea
          value={value as string}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={`${inputCls} resize-none`}
        />
        {field.hint && <p className="text-xs text-amber-200/70 mt-1">{field.hint}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className="text-amber-400 ml-0.5">*</span>}
        {field.unit && <span className="text-amber-300/60 ml-1 normal-case font-normal">({field.unit})</span>}
      </label>
      <input
        type={field.type}
        value={value as string}
        onChange={e => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        className={inputCls}
      />
      {field.hint && <p className="text-xs text-amber-200/50 mt-1">{field.hint}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section renderer
// ─────────────────────────────────────────────────────────────────────────────

function FormSection({
  section,
  form,
  onChange,
  serviceType,
}: {
  section: SectionDef;
  form: FormData;
  onChange: (k: string, v: string | boolean | number) => void;
  serviceType?: string;
}) {
  const hasRoutePicker = section.fields.some(f => f.key === 'origin');
  const hasVehicleSelector = section.fields.some(f => f.key === 'vehicleCategory');

  // If section has origin/destination or vehicleCategory, handle them specially
  const fieldsToRender = section.fields.filter(f => {
    if (hasRoutePicker && (f.key === 'origin' || f.key === 'destination')) return false;
    if (hasVehicleSelector && f.key === 'vehicleCategory') return false;
    return true;
  });

  const visibleFields = fieldsToRender.filter(f => !f.showIf || f.showIf(form));

  // Group consecutive half-width fields into rows of 2
  const rows: FieldDef[][] = [];
  let i = 0;
  while (i < visibleFields.length) {
    const f = visibleFields[i];
    if (f.half && i + 1 < visibleFields.length && visibleFields[i + 1].half) {
      rows.push([f, visibleFields[i + 1]]);
      i += 2;
    } else {
      rows.push([f]);
      i++;
    }
  }

  return (
    <div className="bg-[#121318] border border-amber-500/30 hover:border-amber-500/50 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 transition-all">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-zinc-900/40 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-yellow-500/10 to-amber-500/5 border border-amber-500/30 flex items-center justify-center text-amber-300 shadow-md shadow-amber-500/10">
            {getSectionVectorIcon(section.title)}
          </div>
          <h3 className="text-sm font-extrabold text-white tracking-wide">{section.title}</h3>
        </div>
        <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/15 px-2.5 py-1 rounded-full border border-amber-500/30">
          REQUIRED
        </span>
      </div>

      {/* Fields */}
      <div className="p-5 space-y-4">
        {hasVehicleSelector && (
          <AssetAvailabilitySelector
            serviceType={serviceType || 'RENTAL'}
            startDate={form.startDate as string}
            pickupTime={form.pickupTime as string}
            value={(form.vehicleCategory as string) || ''}
            onChange={(cat, meta) => {
              onChange('vehicleCategory', cat);
              if (meta?.sampleModels) onChange('sampleModels', meta.sampleModels);
              if (meta?.depotId) onChange('depotId', meta.depotId);
            }}
          />
        )}

        {hasRoutePicker && (
          <InteractiveRoutePicker
            origin={(form.origin as string) || ''}
            destination={
              form.sameReturnLoc
                ? (form.origin as string) || ''
                : (form.destination as string) || ''
            }
            onOriginChange={(addr, coords) => {
              onChange('origin', addr);
              if (coords) onChange('originCoords', JSON.stringify(coords));
            }}
            onDestinationChange={(addr, coords) => {
              onChange('destination', addr);
              if (coords) onChange('destCoords', JSON.stringify(coords));
            }}
            onRouteChange={(stats) => {
              onChange('distanceKm', stats.distanceKm);
              onChange('durationMins', stats.durationMins);
              onChange('salikTollsAed', stats.salikTollsAed);
            }}
          />
        )}

        {rows.map((row, ri) => (
          row.length === 2 ? (
            <div key={ri} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {row.map(f => (
                <FieldRenderer key={f.key} field={f} value={form[f.key] ?? ''} onChange={onChange} />
              ))}
            </div>
          ) : (
            <FieldRenderer key={row[0].key} field={row[0]} value={form[row[0].key] ?? ''} onChange={onChange} />
          )
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation summary renderer
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-zinc-900/60 border border-amber-500/15 rounded-xl p-3">
      <span className="text-[10px] text-amber-300/70 uppercase tracking-wider font-semibold">{label}</span>
      <span className="text-sm text-white font-medium">{value}</span>
    </div>
  );
}

const SERVICE_META: Record<ServiceType, { title: string; icon: string; gradient: string; confirmNote?: string }> = {
  RENTAL:         { title: 'Rent-a-Car',      icon: '🚗', gradient: 'from-emerald-600 to-teal-700' },
  LEASING:        { title: 'Vehicle Leasing', icon: '📋', gradient: 'from-blue-600 to-indigo-700' },
  STAFF_TRANSPORT:{ title: 'Staff Transport', icon: '🚌', gradient: 'from-purple-600 to-violet-700' },
  EXECUTIVE:      { title: 'Executive',       icon: '⭐', gradient: 'from-amber-600 to-yellow-700' },
  LOGISTICS:      { title: 'Logistics',       icon: '🚛', gradient: 'from-orange-600 to-amber-700',
    confirmNote: '🚛 Your logistics trip has been sent to the Dispatch Board for vehicle and driver assignment.' },
  SCHOOL_BUS:     { title: 'School Bus',      icon: '🏫', gradient: 'from-yellow-500 to-orange-600',
    confirmNote: '🏫 Your enrollment request is under review. Our team will confirm the route and assigned bus.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main inner component
// ─────────────────────────────────────────────────────────────────────────────

function NewBookingInner() {
  const { hasModule, tenant } = usePermissions();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const router       = useRouter();

  // Dynamically filter service cards based on tenant's enabled modules
  const visibleCards = useMemo(() => {
    if (!tenant || !tenant.enabledModules || tenant.enabledModules.length === 0) {
      return SERVICE_CARDS;
    }
    return SERVICE_CARDS.filter((c) => {
      const requiredModule = SERVICE_MODULE_MAP[c.type];
      return !requiredModule || hasModule(requiredModule);
    });
  }, [hasModule, tenant]);

  const initialType = (searchParams.get('type') ?? '') as ServiceType | '';
  const [step,        setStep]        = useState<1 | 2 | 3>(initialType ? 2 : 1);
  const [serviceType, setServiceType] = useState<ServiceType | ''>(initialType);
  const [form,        setForm]        = useState<FormData>(EMPTY_FORM);
  const [bookingRef,  setBookingRef]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (visibleCards.length === 0) return;
    if (initialType && visibleCards.some(c => c.type === initialType)) {
      setServiceType(initialType as ServiceType);
      setStep(2);
    } else if (visibleCards.length === 1) {
      // Single-domain tenant: auto-advance to details form for the only subscribed service!
      setServiceType(visibleCards[0].type);
      setStep(2);
    } else if (initialType && !visibleCards.some(c => c.type === initialType)) {
      setServiceType('');
      setStep(1);
    }
  }, [initialType, visibleCards]);

  const onChange = (k: string, v: string | boolean | number) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const card = visibleCards.find(c => c.type === serviceType) || SERVICE_CARDS.find(c => c.type === serviceType);
  const schema: SectionDef[] = serviceType ? SCHEMAS[serviceType as ServiceType] : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { _ref, ...payload } = buildPayload(serviceType as ServiceType, form);

      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to create booking');
      }

      const data = await res.json();
      setBookingRef(data.bookingRef ?? _ref);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setServiceType('');
    setForm(EMPTY_FORM);
    setBookingRef('');
    setError('');
  };

  const meta = serviceType ? SERVICE_META[serviceType as ServiceType] : null;

  return (
    <div className="onyx-gold-executive dark [color-scheme:dark] max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8 min-h-screen text-white bg-[#09090b]">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/20 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 mb-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-300 text-xs font-mono font-bold tracking-wider">EXECUTIVE BOOKING CONSOLE</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Fleet360 <span className="bg-gradient-to-r from-amber-400 to-yellow-500 bg-clip-text text-transparent">Booking Portal</span>
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Multi-modal booking & freight dispatch console across all transport domains</p>
        </div>

        {/* ── Progress stepper ── */}
        <div className="flex items-center gap-3 bg-zinc-950/80 border border-amber-500/20 rounded-2xl px-5 py-3 backdrop-blur-xl">
          {(['Select Service', 'Booking Details', 'Confirmation'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    step > n  ? 'bg-emerald-500 text-black font-bold' :
                    step === n ? 'bg-gradient-to-r from-amber-400 to-yellow-500 text-black font-bold shadow-md shadow-amber-500/30' :
                    'bg-zinc-800 text-zinc-500'
                  }`}>
                    {step > n ? '✓' : n}
                  </div>
                  <span className={`text-xs hidden md:block font-medium transition-colors ${
                    step >= n ? 'text-amber-200' : 'text-zinc-500'
                  }`}>{label}</span>
                </div>
                {i < 2 && (
                  <div className={`w-8 h-0.5 rounded-full transition-all ${
                    step > n ? 'bg-emerald-500' : 'bg-zinc-800'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Step 1 — Service Type Selection
      ══════════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white tracking-wide">Select Transport Service Category</h2>
            <span className="text-xs font-mono text-zinc-400">Step 1 of 3</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleCards.map(opt => (
              <button
                key={opt.type}
                onClick={() => { setServiceType(opt.type as ServiceType); setStep(2); }}
                className="group relative bg-[#121318] border border-amber-500/30 hover:border-amber-400 rounded-2xl p-6 text-left hover:shadow-2xl hover:shadow-amber-500/15 transition-all duration-200 hover:scale-[1.02] active:scale-100 flex flex-col justify-between space-y-4 shadow-xl shadow-black/60"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#181920] border border-amber-500/30 flex items-center justify-center text-amber-300 group-hover:scale-110 group-hover:border-amber-400 shadow-lg shadow-amber-500/10 transition-all">
                      {getServiceVectorIcon(opt.type, 'w-6 h-6 text-amber-300')}
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full tracking-wider">
                      {opt.badge}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white group-hover:text-amber-300 transition-colors">
                    {opt.title}
                  </h3>
                  <p className="text-zinc-400 text-xs mt-1.5 leading-relaxed">
                    {opt.desc}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-amber-400 font-semibold group-hover:translate-x-1 transition-transform">
                  <span>Configure Booking</span>
                  <span>→</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Step 2 — Dynamic Form (Pixel-Perfect Gold & Onyx Layout)
      ══════════════════════════════════════════════════════════════ */}
      {step === 2 && card && (
        <div className="space-y-8">
          {/* Top Centered Gold Capsule Navigation Pills */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 p-1.5 rounded-full bg-[#121318] border border-amber-500/30 shadow-2xl shadow-black/80 overflow-x-auto max-w-full">
              {visibleCards.map((opt) => {
                const isActive = serviceType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => {
                      setServiceType(opt.type as ServiceType);
                      setForm(EMPTY_FORM);
                    }}
                    className={`px-6 py-2.5 rounded-full text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? 'bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-500 text-black shadow-lg shadow-amber-500/30 scale-100'
                        : 'text-zinc-400 hover:text-amber-200 hover:bg-zinc-900/60'
                    }`}
                  >
                    {opt.title}
                  </button>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* ── LEFT COLUMN (Inputs & Vehicle Selection Grid) ── */}
              <div className="lg:col-span-8 space-y-6">
                {/* 1. Pickup Origin & Destination Card */}
                <div className="bg-[#121318] border border-amber-500/30 rounded-2xl p-6 space-y-4 shadow-2xl shadow-black/60">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white tracking-wide">Pickup & Destination</h3>
                    <span className="text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                      STEP 1
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="relative flex items-center">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-amber-300/80 uppercase tracking-wider mb-1">
                          Pickup Origin
                        </label>
                        <input
                          type="text"
                          value={(form.origin as string) || ''}
                          onChange={(e) => onChange('origin', e.target.value)}
                          placeholder="Enter pickup address (e.g. Dubai Airport Terminal 3)"
                          className="w-full bg-[#181920] border border-amber-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition-all"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const orig = form.origin;
                          const dest = form.destination;
                          onChange('origin', dest || '');
                          onChange('destination', orig || '');
                        }}
                        className="ml-3 mt-4 w-10 h-10 rounded-xl bg-zinc-900 border border-amber-500/30 hover:border-amber-400 text-amber-300 flex items-center justify-center text-sm transition-all hover:scale-105"
                        title="Swap Origin and Destination"
                      >
                        ⇅
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-amber-300/80 uppercase tracking-wider mb-1">
                        Destination
                      </label>
                      <input
                        type="text"
                        value={(form.destination as string) || ''}
                        onChange={(e) => onChange('destination', e.target.value)}
                        placeholder="Enter destination address (e.g. Burj Al Arab, Jumeirah)"
                        className="w-full bg-[#181920] border border-amber-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Flight Tracking / Consignment Manifest Ref Card */}
                <div className="bg-[#121318] border border-amber-500/30 rounded-2xl p-6 space-y-3 shadow-2xl shadow-black/60">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      {serviceType === 'EXECUTIVE'
                        ? 'Flight Tracking & Meet & Greet'
                        : serviceType === 'LOGISTICS'
                        ? 'B2B Consignment & Customs Reference'
                        : 'Schedule Reference'}
                    </h3>
                    <span className="text-[10px] font-mono text-zinc-400">OPTIONAL</span>
                  </div>

                  <div>
                    <input
                      type="text"
                      value={(form.flightNumber as string) || (form.notes as string) || ''}
                      onChange={(e) => onChange(serviceType === 'EXECUTIVE' ? 'flightNumber' : 'notes', e.target.value)}
                      placeholder={
                        serviceType === 'EXECUTIVE'
                          ? 'Enter Flight Number (e.g. EK202 from JFK) for automatic delay tracking'
                          : 'Enter Manifest or Reference Number (e.g. MAN-2026-DXB)'
                      }
                      className="w-full bg-[#181920] border border-amber-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition-all"
                    />
                  </div>
                </div>

                {/* 3. Luxury Vehicle Selection Grid */}
                <div className="bg-[#121318] border border-amber-500/30 rounded-2xl p-6 space-y-4 shadow-2xl shadow-black/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white tracking-wide">Luxury Vehicle Selection</h3>
                      <p className="text-xs text-zinc-400 mt-0.5">Select your preferred model class and asset tier</p>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                      STEP 2
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      {
                        category: 'MERCEDES_S_CLASS',
                        name: 'Mercedes S-Class',
                        desc: 'Executive VIP Luxury Saloon',
                        badge: 'VIP EXECUTIVE',
                        icon: '⭐',
                        fare: 450,
                      },
                      {
                        category: 'BMW_I7',
                        name: 'BMW i7 Electric',
                        desc: 'Sustainable Green Luxury',
                        badge: 'ZERO EMISSION',
                        icon: '⚡',
                        fare: 480,
                      },
                      {
                        category: 'EXECUTIVE_VAN',
                        name: 'Executive V-Class',
                        desc: '7-Passenger Chauffeur Van',
                        badge: 'GROUP TRAVEL',
                        icon: '🚐',
                        fare: 550,
                      },
                    ].map((veh) => {
                      const isSelected = form.vehicleCategory === veh.category || (!form.vehicleCategory && veh.category === 'MERCEDES_S_CLASS');
                      return (
                        <button
                          key={veh.category}
                          type="button"
                          onClick={() => {
                            onChange('vehicleCategory', veh.category);
                            onChange('fareSubtotal', veh.fare);
                          }}
                          className={`p-4 rounded-xl text-left border transition-all flex flex-col justify-between space-y-3 ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-500/20 scale-[1.02]'
                              : 'bg-[#181920] border-zinc-800 hover:border-amber-500/40 text-zinc-400'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <span className="text-2xl p-2 bg-black/40 rounded-lg border border-amber-500/20">{veh.icon}</span>
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {veh.badge}
                            </span>
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white">{veh.name}</h4>
                            <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{veh.desc}</p>
                          </div>
                          <div className="pt-2 border-t border-white/5 flex justify-between items-center text-xs font-mono">
                            <span className="text-zinc-500">From</span>
                            <span className="text-amber-400 font-bold">AED {veh.fare}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Dynamic Domain-Specific Form Sections */}
                {schema.map((section) => (
                  <FormSection
                    key={section.title}
                    section={section}
                    form={form}
                    onChange={onChange}
                    serviceType={serviceType as string}
                  />
                ))}

                {/* B2B Bulk Consignment Excel / CSV Uploader */}
                {serviceType === 'LOGISTICS' && (
                  <BulkConsignmentUploader
                    onBatchDispatched={(analysis) => {
                      onChange('bulkBatchManifestNo', analysis.masterManifestNumber);
                      onChange('bulkBatchTotalPallets', analysis.totalPallets);
                      onChange('bulkBatchTotalRoutes', analysis.clusters.length);
                      onChange('fareSubtotal', analysis.summaryPricingAed);
                    }}
                  />
                )}

                {/* Multi-Stop Waypoints & LTL Route Optimizer */}
                {serviceType === 'LOGISTICS' && (
                  <MultiStopRoutePicker
                    initialOrigin={(form.origin as string) || 'Jebel Ali (JAFZA) Base Gate 4'}
                    initialDestination={(form.destination as string) || 'Abu Dhabi Kizad Dock 2'}
                    baseFareAed={Number(form.fareSubtotal) || 550}
                    onRouteChange={(routeRes) => {
                      onChange('distanceKm', routeRes.totalDistanceKm);
                      onChange('durationMins', routeRes.totalDurationMins);
                      onChange('salikTollsAed', routeRes.totalSalikTollsAed);
                      onChange('multiStopWaypoints', JSON.stringify(routeRes.optimizedWaypoints));
                      onChange('co2EmissionsKg', routeRes.co2EmissionsKg);
                      if (routeRes.ltlConsolidation.isEligible) {
                        onChange('ltlConsolidationEligible', true);
                        onChange('ltlDiscountAed', routeRes.ltlConsolidation.discountAmountAed);
                      }
                    }}
                  />
                )}

                {/* Digital Bill of Lading (e-BOL) & Pallet Scanner */}
                {serviceType === 'LOGISTICS' && (
                  <DigitalEbolScanner
                    bookingRef={`EXL-FRT-${Math.floor(1000 + Math.random() * 9000)}`}
                    shipperName={(form.requestorName as string) || 'EIN360 General Trading LLC'}
                    shipperAddress={(form.origin as string) || 'JAFZA Logistics Base Gate 4'}
                    consigneeName="Dubai Mall Logistics Dock 3"
                    consigneeAddress={(form.destination as string) || 'Dubai Mall Service Dock 3'}
                    onEbolGenerated={(ebol) => {
                      onChange('ebolNumber', ebol.ebolNumber);
                      onChange('uaeCustomsDeclarationNo', ebol.uaeCustomsDeclarationNo);
                      onChange('ebolCryptographicSeal', ebol.cryptographicSeal);
                    }}
                  />
                )}

                {/* Driver Mobile Handover & Electronic Proof of Delivery (e-POD) */}
                {serviceType === 'LOGISTICS' && (
                  <DriverHandoverEpod
                    bookingRef={`EXL-FRT-${Math.floor(1000 + Math.random() * 9000)}`}
                    ebolNumber={(form.ebolNumber as string) || 'EBOL-EXL-2026-8891'}
                    consigneeName={(form.destination as string) || 'Dubai Mall Logistics Dock 3'}
                    onEpodCompleted={(epod) => {
                      onChange('epodNumber', epod.epodNumber);
                      onChange('epodSeal', epod.cryptographicPODSeal);
                      onChange('deliveryConfirmed', true);
                    }}
                  />
                )}

                {/* Live IoT Telematics & Continuous Cold-Chain Temperature Graph */}
                {serviceType === 'LOGISTICS' && (
                  <ColdChainTelemetryGraph
                    tripRef={`TRIP-${Math.floor(1000 + Math.random() * 9000)}`}
                    cargoTypeKey="FROZEN_PHARMA"
                    onAlertTriggered={(alertMsg) => {
                      onChange('coldChainAlert', alertMsg);
                    }}
                  />
                )}

                {/* Universal Booking Recurrence & Standing Contract Engine */}
                <RecurringSchedulePicker
                  serviceType={serviceType as string}
                  singleTripFareAed={Number(form.fareSubtotal) || 550}
                  onScheduleChange={({ config, trips, pricing }) => {
                    onChange('recurringScheduleType', config.scheduleType);
                    onChange('recurringFrequency', config.frequency);
                    onChange('recurringDays', JSON.stringify(config.daysOfWeek));
                    onChange('recurringTotalTrips', trips.length);
                    onChange('recurringDiscountPercent', pricing.discountPercent);
                    onChange('recurringTotalContractAed', pricing.totalWithVatAed);
                  }}
                />

                {/* Instant Pricing & Corporate Cost Center Allocation */}
                <InstantPricingCostCenter
                  serviceType={serviceType as string}
                  vehicleCategory={(form.vehicleCategory as string) || ''}
                  distanceKm={Number(form.distanceKm) || 0}
                  salikTollsAed={Number(form.salikTollsAed) || 0}
                  costCenter={(form.costCenter as string) || 'CC-OPS-3003'}
                  projectCode={(form.projectCode as string) || ''}
                  billingMethod={(form.billingMethod as string) || 'CORPORATE_ACCOUNT'}
                  onChange={(pricing) => {
                    onChange('fareSubtotal', pricing.fareSubtotal);
                    onChange('vatAmount', pricing.vatAmount);
                    onChange('totalFareAed', pricing.totalFareAed);
                    onChange('costCenter', pricing.costCenter);
                    onChange('projectCode', pricing.projectCode);
                    onChange('billingMethod', pricing.billingMethod);
                    onChange('budgetStatus', pricing.budgetStatus);
                  }}
                />

                {/* Omnichannel Passenger Alerts & WhatsApp Notifications */}
                <OmnichannelNotificationPreferences
                  serviceType={serviceType as string}
                  vehicleCategory={(form.vehicleCategory as string) || ''}
                  pickupLocation={(form.origin as string) || ''}
                  destinationLocation={(form.destination as string) || ''}
                  totalFareAed={Number(form.totalFareAed) || 0}
                  requestorName={(form.requestorName as string) || 'Passenger'}
                  phone={(form.contactPhone as string) || '+971 50 123 4567'}
                  email={(form.requestorEmail as string) || ''}
                  onChange={(channels, phone) => {
                    onChange('notificationChannels', JSON.stringify(channels));
                    onChange('contactPhone', phone);
                  }}
                />

                {/* Digital KYC, UAE Pass & Electronic Signatures */}
                <DigitalKycUaePass
                  requestorName={(form.requestorName as string) || ''}
                  requestorEmail={(form.requestorEmail as string) || ''}
                  onKycVerified={(kyc) => {
                    if (kyc.uaePassVerified) onChange('uaePassVerified', true);
                    if (kyc.emiratesId) onChange('emiratesId', kyc.emiratesId);
                    if (kyc.drivingLicenseNo) onChange('drivingLicenseNo', kyc.drivingLicenseNo);
                    if (kyc.licenseExpiry) onChange('licenseExpiry', kyc.licenseExpiry);
                    if (kyc.signatureHash) onChange('signatureHash', kyc.signatureHash);
                    if (kyc.signatureDataUrl) onChange('signatureDataUrl', kyc.signatureDataUrl);
                  }}
                />

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-start gap-2">
                    <span className="flex-shrink-0">⚠️</span>
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* ── RIGHT COLUMN (Pixel-Perfect Luxury Order Summary Card) ── */}
              <div className="lg:col-span-4 sticky top-20 space-y-4">
                <div className="bg-[#121318] border border-amber-500/30 rounded-2xl p-6 shadow-2xl shadow-black/80 space-y-5">
                  {/* Summary Header */}
                  <div className="border-b border-amber-500/20 pb-3">
                    <h3 className="text-base font-bold text-white">Luxury Order Summary</h3>
                  </div>

                  {/* Summary Details */}
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between text-zinc-400">
                      <span>Trip Details</span>
                      <strong className="text-white font-mono">13:00 – 17:30</strong>
                    </div>
                    {form.destination && (
                      <div className="flex justify-between text-zinc-400">
                        <span>Destination</span>
                        <strong className="text-white truncate max-w-[160px]">{form.destination as string}</strong>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-400">
                      <span>Pickup Summary</span>
                      <span className="text-white">Confirmed VIP</span>
                    </div>
                  </div>

                  {/* Itemized Pricing */}
                  <div className="border-t border-b border-amber-500/20 py-3 space-y-2 text-xs font-mono">
                    <div className="flex justify-between text-zinc-400">
                      <span>Base Fare</span>
                      <span className="text-white font-bold">AED {Number(form.fareSubtotal) || 450}</span>
                    </div>
                    {Number(form.salikTollsAed) > 0 && (
                      <div className="flex justify-between text-zinc-400">
                        <span>Surcharges (Toll/Salik)</span>
                        <span className="text-white font-bold">AED {Number(form.salikTollsAed)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-400">
                      <span>5% UAE VAT</span>
                      <span className="text-white font-bold">
                        AED {Number(form.vatAmount) || Math.round((Number(form.fareSubtotal) || 450) * 0.05)}
                      </span>
                    </div>
                    <div className="pt-2 flex justify-between items-baseline">
                      <span className="text-sm font-bold text-white">Total (Incl. VAT)</span>
                      <span className="text-2xl font-extrabold text-amber-400">
                        AED{' '}
                        {Number(form.totalFareAed) ||
                          Math.round((Number(form.fareSubtotal) || 450) * 1.05 + (Number(form.salikTollsAed) || 0))}
                      </span>
                    </div>
                  </div>

                  {/* Corporate Cost Center Pill */}
                  <div className="flex items-center justify-center">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-mono font-bold">
                      ✓ Corporate Cost Center ({(form.costCenter as string) || 'CC-EXEC-1001'})
                    </span>
                  </div>

                  {/* Full-Width Rounded Capsule Golden Action Button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-4 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-black text-sm font-extrabold shadow-xl shadow-amber-500/30 transition-all flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                          Processing…
                        </span>
                      ) : (
                        'Confirm Booking'
                      )}
                    </button>

                    {!initialType && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="w-full mt-3 py-2 text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        ← Back to Categories
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Step 3 — Confirmation
      ══════════════════════════════════════════════════════════════ */}
      {step === 3 && meta && (
        <div className="space-y-6">
          {/* Success hero */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-emerald-400">Booking Submitted!</h2>
            <p className="text-slate-400 text-sm mt-1">Your request is now pending approval</p>
          </div>

          {/* Booking reference card */}
          <div className="bg-zinc-950/90 border border-amber-500/30 rounded-2xl p-6 space-y-5 shadow-2xl shadow-amber-500/10 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-4">
              <div>
                <p className="text-xs text-amber-300/80 uppercase tracking-wider mb-1 font-semibold">Booking Reference</p>
                <p className="text-3xl font-mono font-bold text-amber-400">{bookingRef}</p>
              </div>
              <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-3 text-3xl shadow-inner">{meta.icon}</div>
            </div>

            {/* Key details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ConfirmationDetail label="Service" value={meta.title} />
              {form.requestorName && <ConfirmationDetail label="Requestor" value={form.requestorName as string} />}
              {form.startDate && (
                <ConfirmationDetail
                  label="Start Date"
                  value={new Date(form.startDate as string).toLocaleDateString('en-AE', { day:'2-digit', month:'short', year:'numeric' })}
                />
              )}
              {form.vehicleCategory && <ConfirmationDetail label="Vehicle Category" value={form.vehicleCategory as string} />}
              {form.sampleModels && <ConfirmationDetail label="Assigned Model Class" value={form.sampleModels as string} />}
              {form.depotId && <ConfirmationDetail label="Dispatch Station / Depot" value={form.depotId as string} />}
              {form.origin && <ConfirmationDetail label="From" value={form.origin as string} />}
              {form.destination && <ConfirmationDetail label="To" value={form.destination as string} />}
              {form.distanceKm ? <ConfirmationDetail label="Driving Distance" value={`${form.distanceKm} km`} /> : null}
              {form.durationMins ? <ConfirmationDetail label="Est. Travel Time" value={`${form.durationMins} mins`} /> : null}
              {form.salikTollsAed !== undefined && Number(form.salikTollsAed) > 0 ? (
                <ConfirmationDetail label="Estimated UAE Tolls (Salik)" value={`AED ${form.salikTollsAed}`} />
              ) : null}
              {form.totalFareAed ? (
                <ConfirmationDetail
                  label="Estimated Fare (incl. 5% VAT)"
                  value={`AED ${Number(form.totalFareAed).toFixed(2)}`}
                />
              ) : null}
              {form.costCenter && <ConfirmationDetail label="Cost Center" value={form.costCenter as string} />}
              {form.billingMethod && (
                <ConfirmationDetail label="Billing Method" value={form.billingMethod as string} />
              )}
              {form.budgetStatus && (
                <ConfirmationDetail
                  label="Budget Policy Status"
                  value={form.budgetStatus === 'WITHIN_POLICY' ? '✅ Within Policy (Pre-Approved)' : '⚠️ Exceeds Cap (Level 2 Escalation)'}
                />
              )}
              {form.uaePassVerified ? (
                <ConfirmationDetail label="Identity Verification" value="🇦🇪 UAE PASS (SOP3 High Assurance)" />
              ) : null}
              {form.emiratesId ? <ConfirmationDetail label="Emirates ID" value={form.emiratesId as string} /> : null}
              {form.drivingLicenseNo ? (
                <ConfirmationDetail label="Driving License" value={form.drivingLicenseNo as string} />
              ) : null}
              {form.signatureHash ? (
                <ConfirmationDetail label="Digital e-Signature" value={`SHA-256: ${(form.signatureHash as string).slice(0, 16)}…`} />
              ) : null}
              {form.contactPhone ? (
                <ConfirmationDetail label="Passenger WhatsApp / Mobile" value={form.contactPhone as string} />
              ) : null}
              {form.studentName && <ConfirmationDetail label="Student" value={form.studentName as string} />}
              {form.companyName && <ConfirmationDetail label="Company" value={form.companyName as string} />}
              {form.leaseDuration && <ConfirmationDetail label="Lease Duration" value={form.leaseDuration as string} />}
              {form.cargo && <ConfirmationDetail label="Cargo" value={form.cargo as string} />}
            </div>

            {/* Service-specific notes */}
            {meta.confirmNote && (
              <div className="bg-zinc-900 border border-amber-500/20 rounded-xl px-4 py-3 text-zinc-300 text-xs leading-relaxed">
                {meta.confirmNote}{' '}
                {serviceType === 'LOGISTICS' && (
                  <a href="/logistics/dispatch" className="underline text-amber-400 hover:text-amber-300">
                    View Dispatch Board →
                  </a>
                )}
              </div>
            )}

            {/* Email confirmation */}
            {form.requestorEmail && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-xs">
                📧 A confirmation will be sent to <strong>{form.requestorEmail as string}</strong>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-4">
            <button
              onClick={() => router.push('/booking-portal')}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 px-6 py-3.5 text-sm font-bold text-black shadow-lg shadow-amber-500/20 hover:scale-[1.01] transition-all"
            >
              View All Bookings →
            </button>
            <button
              onClick={resetForm}
              className="flex-1 rounded-xl bg-zinc-900 hover:bg-zinc-800 px-6 py-3.5 text-sm font-medium text-zinc-300 transition-all border border-white/10"
            >
              + Create Another Booking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export — wrapped in Suspense for useSearchParams
// ─────────────────────────────────────────────────────────────────────────────

export default function NewBookingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <NewBookingInner />
    </Suspense>
  );
}
