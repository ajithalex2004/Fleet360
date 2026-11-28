'use client';
export const dynamic = 'force-dynamic';
import { formInputCls } from '@/components/ui/form-kit';
import React, { useState, useEffect, Suspense, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  UserCheck,
  CarFront,
  Truck,
  MapPin,
  Plane,
  ShieldCheck,
  FileCheck,
  Clock,
  Sparkles,
  Bus,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Building2,
  Receipt,
  CreditCard,
  User,
  Paperclip,
  ExternalLink,
} from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import {
  buildDynamicServiceCards,
  findCatalogCategoryForBookingType,
  mergeCatalogDefaults,
  resolveDynamicBookingSchema,
  type BookingCatalogCategory,
} from '@/lib/booking-portal/catalog-adapter';
import { calculateInstantQuotation } from '@/lib/pricing/instant-quotation';
import { InteractiveRoutePicker } from '@/components/booking/InteractiveRoutePicker';
import { AssetAvailabilitySelector } from '@/components/booking/AssetAvailabilitySelector';
import { InstantPricingCostCenter } from '@/components/booking/InstantPricingCostCenter';
import { OmnichannelNotificationPreferences } from '@/components/booking/OmnichannelNotificationPreferences';
import { DigitalKycUaePass } from '@/components/booking/DigitalKycUaePass';
import { MultiStopRoutePicker } from '@/components/booking/MultiStopRoutePicker';
import { RecurringSchedulePicker } from '@/components/booking/RecurringSchedulePicker';
import { BulkConsignmentUploader } from '@/components/booking/BulkConsignmentUploader';
import {
  BookingDocumentDropzone,
  type UploadedBookingDocument,
  type DocumentUploadSlot,
} from '@/components/booking/BookingDocumentDropzone';

function getServiceVectorIcon(type: string, className = 'w-5 h-5 text-cyan-500') {
  switch (type) {
    case 'RENTAL':
      return <CarFront className={className} />;
    case 'LEASING':
      return <FileCheck className={className} />;
    case 'STAFF_TRANSPORT':
      return <Bus className={className} />;
    case 'EXECUTIVE':
      return <Sparkles className={className} />;
    case 'LOGISTICS':
      return <Truck className={className} />;
    case 'SCHOOL_BUS':
      return <GraduationCap className={className} />;
    default:
      return <Sparkles className={className} />;
  }
}

function getSectionVectorIcon(title: string, className = 'w-4 h-4 text-cyan-500') {
  const t = title.toLowerCase();
  if (t.includes('driver') || t.includes('employee') || t.includes('booker') || t.includes('parent') || t.includes('shipper') || t.includes('company')) {
    return <UserCheck className={className} />;
  }
  if (t.includes('vehicle') || t.includes('fleet') || t.includes('equipment') || t.includes('protection')) {
    return <CarFront className={className} />;
  }
  if (t.includes('schedule') || t.includes('period') || t.includes('shift') || t.includes('term')) {
    return <Clock className={className} />;
  }
  if (t.includes('location') || t.includes('route') || t.includes('itinerary') || t.includes('residence') || t.includes('dock')) {
    return <MapPin className={className} />;
  }
  if (t.includes('cargo') || t.includes('freight') || t.includes('packaging') || t.includes('accessorial')) {
    return <Truck className={className} />;
  }
  if (t.includes('flight') || t.includes('protocol') || t.includes('meet')) {
    return <Plane className={className} />;
  }
  if (t.includes('student') || t.includes('school') || t.includes('medical') || t.includes('safety') || t.includes('hazmat') || t.includes('dangerous') || t.includes('guardian')) {
    return <ShieldCheck className={className} />;
  }
  if (t.includes('lease') || t.includes('inclusion') || t.includes('contract')) {
    return <FileCheck className={className} />;
  }
  return <Sparkles className={className} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service type card definitions (Step 1)
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_CARDS = [
  {
    type: 'RENTAL',
    title: 'Rent-a-Car',
    desc: 'Self-drive short-term rentals with UAE RTA compliance & protection packages',
    icon: '🚗',
    gradient: 'from-emerald-600 to-teal-700',
    badge: 'RENTAL',
    accent: 'emerald',
  },
  {
    type: 'LEASING',
    title: 'Vehicle Leasing',
    desc: 'Long-term corporate & SME fleet lease proposals with full-service inclusions',
    icon: '📋',
    gradient: 'from-blue-600 to-indigo-700',
    badge: 'LEASING',
    accent: 'blue',
  },
  {
    type: 'STAFF_TRANSPORT',
    title: 'Staff Transport',
    desc: 'Employee commuter shuttle passes & dedicated shift bus bookings',
    icon: '🚌',
    gradient: 'from-purple-600 to-violet-700',
    badge: 'SHUTTLE',
    accent: 'purple',
  },
  {
    type: 'EXECUTIVE',
    title: 'Executive Vehicle',
    desc: 'Chauffeur-driven luxury vehicles for VIP transfers, airports & roadshows',
    icon: '⭐',
    gradient: 'from-amber-600 to-yellow-700',
    badge: 'PREMIUM',
    accent: 'amber',
  },
  {
    type: 'LOGISTICS',
    title: 'Logistics Trip',
    desc: 'B2B freight dispatch with FTL/LTL, cold-chain, hazmat & customs compliance',
    icon: '🚛',
    gradient: 'from-orange-600 to-amber-700',
    badge: 'LOGISTICS',
    accent: 'orange',
  },
  {
    type: 'SCHOOL_BUS',
    title: 'School Bus',
    desc: 'RTA-compliant student bus enrollment, home stop mapping & parent alerts',
    icon: '🏫',
    gradient: 'from-yellow-500 to-orange-600',
    badge: 'SCHOOL',
    accent: 'yellow',
  },
] as const;

type ServiceType = typeof SERVICE_CARDS[number]['type'];

// ─────────────────────────────────────────────────────────────────────────────
// Domain-Specific Primary Selector Cards (replaces hardcoded Luxury Vehicle card)
// ─────────────────────────────────────────────────────────────────────────────

interface PrimaryOptionCard {
  value: string;
  title: string;
  desc: string;
  badge: string;
  icon: string;
  rateLabel: string;
  baseRate: number;
  specs?: string;
}

interface DomainPrimarySelectorConfig {
  heading: string;
  subtitle: string;
  fieldKey: string;
  gridCols: string;
  showLiveStockToggle: boolean;
  options: PrimaryOptionCard[];
}

const DOMAIN_PRIMARY_SELECTORS: Record<ServiceType, DomainPrimarySelectorConfig> = {
  RENTAL: {
    heading: 'Rental Vehicle Class Selection',
    subtitle: 'Choose your self-drive fleet category — daily rates include standard UAE RTA insurance',
    fieldKey: 'vehicleCategory',
    gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    showLiveStockToggle: true,
    options: [
      {
        value: 'Economy',
        title: 'Economy Sedan',
        desc: 'Nissan Sunny / Mitsubishi Attrage',
        badge: '5 PAX · 2 BAGS',
        icon: '🚗',
        rateLabel: 'AED 90 / day',
        baseRate: 90,
      },
      {
        value: 'Compact',
        title: 'Compact Hatchback',
        desc: 'Toyota Yaris / Hyundai Accent',
        badge: '5 PAX · CITY',
        icon: '🚙',
        rateLabel: 'AED 110 / day',
        baseRate: 110,
      },
      {
        value: 'Mid-Size',
        title: 'Mid-Size Sedan',
        desc: 'Toyota Camry / Honda Accord',
        badge: 'MOST POPULAR',
        icon: '🚘',
        rateLabel: 'AED 140 / day',
        baseRate: 140,
      },
      {
        value: 'SUV',
        title: 'Family / Business SUV',
        desc: 'Toyota RAV4 / Hyundai Tucson',
        badge: '5 PAX · 4 BAGS',
        icon: '🚐',
        rateLabel: 'AED 220 / day',
        baseRate: 220,
      },
      {
        value: '4x4',
        title: 'Full-Size 4x4',
        desc: 'Toyota Land Cruiser / Nissan Patrol',
        badge: '7 PAX · 25+ YRS',
        icon: '🛻',
        rateLabel: 'AED 280 / day',
        baseRate: 280,
      },
      {
        value: 'Van',
        title: 'Multi-Seat Van',
        desc: 'Kia Carnival / Toyota HiAce',
        badge: '7–14 PAX',
        icon: '🚌',
        rateLabel: 'AED 240 / day',
        baseRate: 240,
      },
    ],
  },
  LEASING: {
    heading: 'Lease Program Structure',
    subtitle: 'Select the contract model aligned with your corporate fleet & accounting policy',
    fieldKey: 'leaseType',
    gridCols: 'grid-cols-1 sm:grid-cols-2',
    showLiveStockToggle: true,
    options: [
      {
        value: 'Operating Lease (Full-Service)',
        title: 'Operating Lease (Full-Service)',
        desc: 'All-inclusive fixed monthly rental covering SMR, insurance & relief vehicle',
        badge: 'RECOMMENDED',
        icon: '📋',
        rateLabel: '12–60 Months',
        baseRate: 2100,
      },
      {
        value: 'Finance Lease / Lease-to-Own',
        title: 'Finance Lease / Lease-to-Own',
        desc: 'Structured buyout option transferring vehicle ownership at contract maturity',
        badge: 'ASSET EQUITY',
        icon: '🏦',
        rateLabel: '24–60 Months',
        baseRate: 2450,
      },
      {
        value: 'Flexi-Lease (3–11 Months)',
        title: 'Corporate Flexi-Lease',
        desc: 'Mid-term project fleet with flexible return windows and zero early-exit fees',
        badge: 'PROJECT FLEET',
        icon: '🔄',
        rateLabel: '3–11 Months',
        baseRate: 2650,
      },
      {
        value: 'EV / Green Fleet Lease',
        title: 'EV / Green Fleet Program',
        desc: 'Zero-emission electric & hybrid fleet with ESG Scope-3 reporting & charging support',
        badge: 'NET-ZERO ESG',
        icon: '⚡',
        rateLabel: '24–48 Months',
        baseRate: 2800,
      },
    ],
  },
  STAFF_TRANSPORT: {
    heading: 'Staff Shuttle & Bus Service Selection',
    subtitle: 'Register an individual commuter pass or charter a dedicated shift shuttle for your team',
    fieldKey: 'vehicleCategory',
    gridCols: 'grid-cols-1 sm:grid-cols-2',
    showLiveStockToggle: true,
    options: [
      {
        value: 'Scheduled Shuttle Pass',
        title: 'Employee Daily Commute Pass',
        desc: 'Seat enrollment on scheduled corporate home-to-office shared shuttle routes',
        badge: 'INDIVIDUAL PASS',
        icon: '🎫',
        rateLabel: 'AED 200 / mo',
        baseRate: 200,
      },
      {
        value: '14-Seat Minibus',
        title: '14-Seat Team Minibus',
        desc: 'Toyota HiAce High Roof — ideal for small shift crews & inter-site transfers',
        badge: 'UP TO 14 STAFF',
        icon: '🚐',
        rateLabel: 'From AED 200 / trip',
        baseRate: 200,
      },
      {
        value: '30-Seat Coaster',
        title: '30-Seat Department Coaster',
        desc: 'Toyota Coaster AC Bus — standard departmental & office park shift shuttle',
        badge: 'UP TO 30 STAFF',
        icon: '🚌',
        rateLabel: 'From AED 350 / trip',
        baseRate: 350,
      },
      {
        value: '50-Seat Luxury Coach',
        title: '50-Seat Workforce Coach',
        desc: 'Full-size AC coach for high-capacity workforce, warehouse & industrial sites',
        badge: 'UP TO 50 STAFF',
        icon: '🚍',
        rateLabel: 'From AED 600 / trip',
        baseRate: 600,
      },
    ],
  },
  EXECUTIVE: {
    heading: 'Executive Chauffeur Class Selection',
    subtitle: 'Select your preferred chauffeur-driven vehicle tier and protocol class',
    fieldKey: 'vehicleCategory',
    gridCols: 'grid-cols-1 sm:grid-cols-2',
    showLiveStockToggle: true,
    options: [
      {
        value: 'Business Sedan',
        title: 'Business Class Sedan',
        desc: 'Lexus ES300h / BMW 5-Series · Executive city & airport transfers',
        badge: '3 PAX · 2 BAGS',
        icon: '🚘',
        rateLabel: 'From AED 120',
        baseRate: 120,
      },
      {
        value: 'Luxury Sedan',
        title: 'First Class Luxury Saloon',
        desc: 'Mercedes-Benz S-Class / BMW i7 Electric · Flagship VIP discretion',
        badge: 'VIP FIRST CLASS',
        icon: '⭐',
        rateLabel: 'From AED 180',
        baseRate: 180,
      },
      {
        value: 'Luxury SUV',
        title: 'Luxury Executive SUV',
        desc: 'Range Rover Vogue / Cadillac Escalade · Protocol & delegation travel',
        badge: '5 PAX · 4 BAGS',
        icon: '🚙',
        rateLabel: 'From AED 250',
        baseRate: 250,
      },
      {
        value: 'Executive Van (MPV)',
        title: 'Executive V-Class MPV',
        desc: 'Mercedes-Benz V-Class · 7-Passenger boardroom van with luggage capacity',
        badge: '7 PAX · GROUP VIP',
        icon: '🚐',
        rateLabel: 'From AED 220',
        baseRate: 220,
      },
    ],
  },
  LOGISTICS: {
    heading: 'Commercial Fleet & Equipment Selection',
    subtitle: 'Select the commercial truck or trailer matched to your shipment payload and temperature specs',
    fieldKey: 'vehicleCategory',
    gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    showLiveStockToggle: true,
    options: [
      {
        value: '1-Ton Courier Van',
        title: '1-Ton Cargo Van',
        desc: 'Toyota HiAce Panel Van · Express parcels & urban commercial deliveries',
        badge: 'UP TO 1 TON',
        icon: '🚐',
        rateLabel: 'From AED 150',
        baseRate: 150,
      },
      {
        value: '3-Ton Box Truck',
        title: '3-Ton Dry Box Truck',
        desc: 'Isuzu NPR 4.2m · Standard palletized B2B retail & warehouse cargo',
        badge: 'UP TO 6 PALLETS',
        icon: '🚚',
        rateLabel: 'From AED 250',
        baseRate: 250,
      },
      {
        value: '3-Ton Reefer (Cold-Chain)',
        title: '3-Ton Reefer Truck',
        desc: 'Chilled / Frozen (-18°C to +8°C) · Pharma GDP & Foodwatch compliant',
        badge: 'COLD CHAIN',
        icon: '❄️',
        rateLabel: 'From AED 350',
        baseRate: 350,
      },
      {
        value: '7-Ton Curtain Sider',
        title: '7-Ton Curtain Sider',
        desc: 'Hino 500 Heavy Truck · Side-loading pallets & regional distribution',
        badge: 'UP TO 14 PALLETS',
        icon: '🚛',
        rateLabel: 'From AED 500',
        baseRate: 500,
      },
      {
        value: '40ft Flatbed Trailer',
        title: '40ft Flatbed / Container Rig',
        desc: 'Mercedes Actros 40T · FCL containers, heavy machinery & project freight',
        badge: 'HEAVY / FCL',
        icon: '🏗️',
        rateLabel: 'From AED 850',
        baseRate: 850,
      },
    ],
  },
  SCHOOL_BUS: {
    heading: 'School Transport Service Plan',
    subtitle: 'Select the RTA-compliant student bus plan for the academic term — GPS & RFID attendance included',
    fieldKey: 'vehicleCategory',
    gridCols: 'grid-cols-1 sm:grid-cols-2',
    showLiveStockToggle: false,
    options: [
      {
        value: 'Two-Way Full Service',
        title: 'Two-Way Full Service',
        desc: 'Morning home pickup to school + afternoon return drop-off with bus attendant',
        badge: 'MOST POPULAR',
        icon: '🚌',
        rateLabel: 'AED 450 / mo',
        baseRate: 450,
      },
      {
        value: 'Morning Pickup Only',
        title: 'Morning Pickup Only',
        desc: 'One-way morning transport from home community stop to school campus',
        badge: 'ONE-WAY AM',
        icon: '🌅',
        rateLabel: 'AED 280 / mo',
        baseRate: 280,
      },
      {
        value: 'Afternoon Drop-off Only',
        title: 'Afternoon Drop-off Only',
        desc: 'One-way afternoon return service from school campus to home drop point',
        badge: 'ONE-WAY PM',
        icon: '🌇',
        rateLabel: 'AED 280 / mo',
        baseRate: 280,
      },
      {
        value: 'After-School Activity Bus',
        title: 'After-School Activity Bus',
        desc: 'Late dismissal return transport for clubs, sports & extra-curricular sessions',
        badge: 'LATE RETURN',
        icon: '🎒',
        rateLabel: 'AED 320 / mo',
        baseRate: 320,
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Field schema — one config object drives all rendering (Globally Benchmarked)
// ─────────────────────────────────────────────────────────────────────────────

type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'date' | 'time'
  | 'select' | 'textarea' | 'toggle';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  half?: boolean;
  unit?: string;
  showIf?: (form: FormData) => boolean;
}

interface SectionDef {
  title: string;
  icon: string;
  fields: FieldDef[];
}

const SCHEMAS: Record<ServiceType, SectionDef[]> = {
  // ── RENTAL (Benchmarked vs Hertz, Enterprise, Sixt, UAE RTA) ──────────────
  RENTAL: [
    {
      title: 'Rental Period & Branch Locations',
      icon: '📅',
      fields: [
        { key: 'startDate',     label: 'Pickup Date',      type: 'date', required: true, half: true },
        { key: 'pickupTime',    label: 'Pickup Time',      type: 'time', required: true, half: true },
        { key: 'endDate',       label: 'Return Date',      type: 'date', required: true, half: true },
        { key: 'returnTime',    label: 'Return Time',      type: 'time', required: true, half: true },
        { key: 'origin',        label: 'Pickup Branch / Location', type: 'text', placeholder: 'Airport terminal, branch, hotel, or delivery address', required: true },
        { key: 'sameReturnLoc', label: 'Return vehicle to the same location', type: 'toggle',
          hint: 'Disable to specify a different drop-off branch (one-way fee may apply)' },
        { key: 'destination',   label: 'Return Branch / Location', type: 'text', placeholder: 'Different drop-off branch or address',
          required: true, showIf: (f) => !f.sameReturnLoc },
        { key: 'flightNo',      label: 'Arrival Flight Number (Airport Pickups)', type: 'text', placeholder: 'e.g. EK002 — holds booking if flight is delayed', half: true },
      ],
    },
    {
      title: 'Primary Driver & License Compliance',
      icon: '👤',
      fields: [
        { key: 'requestorName',  label: 'Primary Driver Full Name', type: 'text',  placeholder: 'Exact name as on Driving License / Passport', required: true, half: true },
        { key: 'requestorEmail', label: 'Email Address',            type: 'email', placeholder: 'driver@company.com',                          required: true, half: true },
        { key: 'phone',          label: 'Mobile Number',            type: 'tel',   placeholder: '+971 50 000 0000',                            required: true, half: true },
        { key: 'driverDob',      label: 'Driver Date of Birth',     type: 'date',  required: true, half: true,
          hint: 'UAE RTA minimum age is 21 (25+ for 4x4 & premium SUVs)' },
        { key: 'licenseCountry', label: 'License Issuing Country',  type: 'select', required: true, half: true,
          options: ['United Arab Emirates', 'Saudi Arabia / GCC', 'United Kingdom', 'United States', 'European Union', 'India', 'Other International'] },
        { key: 'emiratesId',     label: 'Emirates ID / Passport No.', type: 'text', placeholder: '784-XXXX-XXXXXXX-X or Passport No.',         required: true, half: true },
        { key: 'licenseNo',      label: 'Driving License No.',      type: 'text',  placeholder: 'Valid license number',                        required: true, half: true },
        { key: 'licenseExpiry',  label: 'License Expiry Date',      type: 'date',  required: true, half: true },
        { key: 'idpRequired',    label: 'International Driving Permit (IDP) Held', type: 'toggle',
          hint: 'Required by UAE RTA for visitors whose domestic license is not on the approved list',
          showIf: (f) => !!f.licenseCountry && f.licenseCountry !== 'United Arab Emirates' && f.licenseCountry !== 'Saudi Arabia / GCC' },
      ],
    },
    {
      title: 'Protection Package, Preferences & Extras',
      icon: '🛡️',
      fields: [
        { key: 'insurancePackage', label: 'Insurance & Excess Protection', type: 'select', required: true, half: true,
          options: [
            'Basic CDW (Standard Excess)',
            'Super CDW (Zero Excess · +AED 45/day)',
            'Full Protection (Zero Excess + Glass & Tyres · +AED 75/day)',
          ] },
        { key: 'mileagePlan',    label: 'Mileage Allowance',        type: 'select', required: true, half: true,
          options: ['Standard (250 km/day)', 'Extended (400 km/day)', 'Unlimited Mileage'] },
        { key: 'transmission',   label: 'Transmission',             type: 'select', half: true,
          options: ['Automatic', 'Manual', 'No Preference'] },
        { key: 'fuelType',       label: 'Powertrain / Fuel',        type: 'select', half: true,
          options: ['Petrol', 'Hybrid', 'Electric', 'Diesel', 'No Preference'] },
        { key: 'childSeat',      label: 'Child / Booster Seat',     type: 'select', half: true,
          options: ['None', 'Infant Seat (0–1 yr · +AED 25/day)', 'Toddler Seat (1–4 yrs · +AED 25/day)', 'Booster Seat (4–8 yrs · +AED 25/day)'] },
        { key: 'additionalDriver', label: 'Additional Authorized Driver (+AED 35/day)', type: 'toggle',
          hint: 'Second driver must present valid driving license & ID at handover' },
        { key: 'gpsUnit',        label: 'GPS Navigation / In-Car WiFi (+AED 20/day)', type: 'toggle',
          hint: 'Pre-loaded GCC navigation & 5G hotspot' },
        { key: 'crossBorderPermit', label: 'GCC Cross-Border NOC (Oman)', type: 'toggle',
          hint: 'Requires advance insurance extension & border NOC letter' },
        { key: 'notes',          label: 'Special Requests',         type: 'textarea',
          placeholder: 'Doorstep delivery instructions, corporate loyalty code, preferred colour…' },
      ],
    },
  ],

  // ── LEASING (Benchmarked vs Ayvens, Arval, Element Fleet) ─────────────────
  LEASING: [
    {
      title: 'Company & Procurement Contact',
      icon: '🏢',
      fields: [
        { key: 'customerType',   label: 'Account Type',             type: 'select', required: true, half: true,
          options: ['Corporate / Enterprise', 'SME / Commercial', 'Government / Semi-Gov', 'Individual Long-Term'] },
        { key: 'companyName',    label: 'Legal Company Name',       type: 'text',   placeholder: 'Registered trade name', required: true, half: true,
          showIf: (f) => f.customerType !== 'Individual Long-Term' },
        { key: 'requestorName',  label: 'Contact Person Name',      type: 'text',   placeholder: 'Full name',             required: true, half: true },
        { key: 'jobTitle',       label: 'Job Title / Role',         type: 'text',   placeholder: 'Fleet Manager, Procurement, HR…', half: true,
          showIf: (f) => f.customerType !== 'Individual Long-Term' },
        { key: 'requestorEmail', label: 'Corporate Email',          type: 'email',  placeholder: 'fleet@company.com',     required: true, half: true },
        { key: 'phone',          label: 'Direct Phone / Mobile',    type: 'tel',    placeholder: '+971 50 000 0000',      required: true, half: true },
        { key: 'tradeNo',        label: 'Trade License No.',        type: 'text',   placeholder: 'CN-XXXXXXX',            required: true, half: true,
          showIf: (f) => f.customerType !== 'Individual Long-Term' },
        { key: 'vatNo',          label: 'UAE TRN / VAT No.',        type: 'text',   placeholder: '100XXXXXXXXX003',       half: true,
          showIf: (f) => f.customerType !== 'Individual Long-Term' },
      ],
    },
    {
      title: 'Fleet Composition & Contract Terms',
      icon: '🚙',
      fields: [
        { key: 'vehicleCategory', label: 'Primary Vehicle Segment', type: 'select', required: true, half: true,
          options: ['Compact Sedan', 'Mid-Size Sedan', 'SUV', 'Van (7-seater)', 'Mini-Bus', 'Bus', 'Pickup Truck', 'Mixed Fleet'] },
        { key: 'quantity',        label: 'Number of Vehicles',      type: 'number', placeholder: '5', required: true, half: true, unit: 'vehicles' },
        { key: 'leaseDuration',   label: 'Contract Term',           type: 'select', required: true, half: true,
          options: ['6 months', '12 months', '18 months', '24 months', '36 months', '48 months', '60 months'] },
        { key: 'annualMileage',   label: 'Annual Mileage Cap',      type: 'select', required: true, half: true,
          options: ['20,000 km/yr', '30,000 km/yr', '40,000 km/yr', '60,000 km/yr', 'Unlimited'] },
        { key: 'startDate',       label: 'Target Fleet Delivery Date', type: 'date', required: true, half: true },
        { key: 'deliveryEmirate', label: 'Delivery Emirate',        type: 'select', required: true, half: true,
          options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Multi-Emirate'] },
        { key: 'monthlyBudget',   label: 'Target Budget / Vehicle', type: 'number', placeholder: '2500', half: true, unit: 'AED/mo' },
      ],
    },
    {
      title: 'Vehicle & Powertrain Specifications',
      icon: '⚙️',
      fields: [
        { key: 'preferredBrand',  label: 'Preferred Make / Model(s)', type: 'text', placeholder: 'Toyota Corolla, Nissan X-Trail, Tesla Model Y…', half: true },
        { key: 'fuelType',        label: 'Powertrain Preference',   type: 'select', half: true,
          options: ['Petrol (ICE)', 'Hybrid (HEV)', 'Plug-in Hybrid (PHEV)', 'Fully Electric (BEV)', 'Diesel', 'No Preference'] },
        { key: 'transmission',    label: 'Transmission',            type: 'select', half: true,
          options: ['Automatic', 'Manual', 'No Preference'] },
        { key: 'color',           label: 'Exterior Colour',         type: 'text',   placeholder: 'White, Silver, Fleet Branded…', half: true },
      ],
    },
    {
      title: 'Full-Service Lease Inclusions',
      icon: '✅',
      fields: [
        { key: 'insuranceIncluded',          label: 'Comprehensive Fleet Insurance & Accident Management', type: 'toggle',
          hint: 'Full third-party, comprehensive cover & claims handling included in monthly rate' },
        { key: 'maintenanceIncluded',        label: 'Scheduled Maintenance, Servicing & Repair (SMR)', type: 'toggle',
          hint: 'Manufacturer scheduled services, mechanical repairs & RTA registration renewal' },
        { key: 'tyresIncluded',              label: 'Tyre Replacement & Alignment', type: 'toggle',
          hint: 'Includes fair wear-and-tear tyre replacement' },
        { key: 'replacementVehicleIncluded', label: '24/7 Relief / Replacement Vehicle', type: 'toggle',
          hint: 'Guaranteed courtesy vehicle during scheduled service or accident downtime' },
        { key: 'roadsideAssistance',         label: '24/7 Roadside Assistance & Recovery', type: 'toggle',
          hint: 'UAE-wide breakdown recovery and battery/tyre dispatch' },
        { key: 'salikIncluded',              label: 'Salik / Darb Toll & Traffic Fine Administration', type: 'toggle',
          hint: 'Consolidated monthly billing for tolls and RTA traffic fines' },
        { key: 'telematicsIncluded',         label: 'GPS Telematics & ESG Fleet Portal Access', type: 'toggle',
          hint: 'Live fleet utilization, driver safety scoring & CO2 reporting' },
        { key: 'notes',                      label: 'Upfitting, Branding & RFP Notes', type: 'textarea',
          placeholder: 'Commercial shelving, livery/branding specs, phased delivery schedule, payment terms…' },
      ],
    },
  ],

  // ── STAFF_TRANSPORT (Benchmarked vs MoveInSync, Zeelo, Liftango) ──────────
  STAFF_TRANSPORT: [
    {
      title: 'Employee Profile & Safety Contact',
      icon: '👤',
      fields: [
        { key: 'requestorName',    label: 'Employee Full Name',     type: 'text',  placeholder: 'Full name as per corporate directory', required: true, half: true },
        { key: 'employeeId',       label: 'Employee ID / Badge No.', type: 'text', placeholder: 'EMP-XXXXX',                            required: true, half: true },
        { key: 'requestorEmail',   label: 'Work Email',             type: 'email', placeholder: 'name@company.com',                     required: true, half: true },
        { key: 'phone',            label: 'Mobile / WhatsApp No.',  type: 'tel',   placeholder: '+971 50 000 0000',                     required: true, half: true },
        { key: 'department',       label: 'Department',             type: 'text',  placeholder: 'Operations, IT, Finance, HR…',         required: true, half: true },
        { key: 'emergencyContact', label: 'Emergency Contact (Name & Phone)', type: 'text', placeholder: 'Next-of-kin name & +971 5X…', half: true },
      ],
    },
    {
      title: 'Commute Route & Stop Mapping',
      icon: '📍',
      fields: [
        { key: 'commuteDirection',      label: 'Trip Direction', type: 'select', required: true, half: true,
          options: [
            'Two-Way (Home ↔ Workplace)',
            'Inbound Only (Home → Workplace)',
            'Outbound Only (Workplace → Home)',
            'Inter-Site Shuttle (Office A ↔ Office B)',
          ] },
        { key: 'preferredStopLandmark', label: 'Nearest Bus Stop / Landmark / Gate', type: 'text',
          placeholder: 'e.g. Al Nahda Metro Exit 2, Gate 3 Lobby', half: true },
        { key: 'origin',                label: 'Home Pickup Area / Stop', type: 'text',
          placeholder: 'Residential community, street, or shuttle stop', required: true },
        { key: 'destination',           label: 'Office / Workplace Facility', type: 'text',
          placeholder: 'Office tower, warehouse hub, or project site', required: true },
      ],
    },
    {
      title: 'Shift & Weekly Commute Schedule',
      icon: '🗓️',
      fields: [
        { key: 'passType',   label: 'Booking Cadence',       type: 'select', required: true, half: true,
          options: ['Regular Standing Pass', 'Hybrid / Flexible Days', 'Temporary / Ad-Hoc Shift'] },
        { key: 'shiftType',  label: 'Shift Window',          type: 'select', required: true, half: true,
          options: ['Morning (06:00–14:00)', 'Afternoon (14:00–22:00)', 'Night (22:00–06:00)', 'Standard (09:00–18:00)', 'Split Shift'] },
        { key: 'workDays',   label: 'Working Days',          type: 'select', required: true, half: true,
          options: ['Monday–Friday', 'Sunday–Thursday', 'Monday–Saturday', 'Sunday–Saturday', 'Custom Hybrid Days'] },
        { key: 'paxCount',   label: 'Number of Staff / Seats', type: 'number', placeholder: '10', required: true, half: true, unit: 'staff',
          showIf: (f) => !!f.vehicleCategory && f.vehicleCategory !== 'Scheduled Shuttle Pass' },
        { key: 'pickupTime', label: 'Inbound Pickup Time',   type: 'time', required: true, half: true,
          showIf: (f) => f.commuteDirection !== 'Outbound Only (Workplace → Home)' },
        { key: 'returnTime', label: 'Outbound Return Time',  type: 'time', required: true, half: true,
          showIf: (f) => f.commuteDirection !== 'Inbound Only (Home → Workplace)' },
        { key: 'startDate',  label: 'Service Start Date',    type: 'date', required: true, half: true },
        { key: 'endDate',    label: 'Service End Date (Optional)', type: 'date', half: true,
          hint: 'Leave blank for ongoing permanent pass' },
      ],
    },
    {
      title: 'Accessibility & Boarding Requirements',
      icon: '♿',
      fields: [
        { key: 'accessibilityNeeds', label: 'Accessibility / Special Assistance', type: 'select', half: true,
          options: ['None', 'Wheelchair Accessible', 'Front-Seat Priority', 'Hearing / Visual Assistance', 'Other'] },
        { key: 'genderPreference',   label: 'Shuttle / Driver Preference', type: 'select', half: true,
          options: ['No Preference', 'Female-Only Shuttle / Section', 'Male Driver', 'Female Driver'] },
        { key: 'notes',              label: 'Gate Access & Pickup Instructions', type: 'textarea',
          placeholder: 'Exact residential gate, security pass details, or equipment carried…' },
      ],
    },
  ],

  // ── EXECUTIVE (Benchmarked vs Blacklane, Carey, Wheely) ───────────────────
  EXECUTIVE: [
    {
      title: 'Journey Itinerary & Flight Tracking',
      icon: '🛫',
      fields: [
        { key: 'tripType',     label: 'Service / Trip Type', type: 'select', required: true, half: true,
          options: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)', 'City Transfer', 'Event / Function', 'Road Show', 'Full Day', 'Multi-Day'] },
        { key: 'charterHours', label: 'Hourly Charter Duration', type: 'select', half: true,
          options: ['3 Hours', '5 Hours', '8 Hours (Full Day)', '10 Hours', '12 Hours'],
          showIf: (f) => ['Event / Function', 'Road Show', 'Full Day', 'Multi-Day'].includes(String(f.tripType || '')) },
        { key: 'origin',       label: 'Pickup Location',    type: 'text', placeholder: 'Hotel, office, residence, or airport terminal', required: true },
        { key: 'destination',  label: 'Drop-off Location',  type: 'text', placeholder: 'Destination address, venue, or terminal', required: true },
        { key: 'startDate',    label: 'Pickup Date',        type: 'date', required: true, half: true },
        { key: 'pickupTime',   label: 'Pickup Time',        type: 'time', required: true, half: true },
        { key: 'flightNo',     label: 'Flight Number',      type: 'text', placeholder: 'e.g. EK202 — live delay tracking & buffer', half: true,
          showIf: (f) => String(f.tripType || '').includes('Airport') },
        { key: 'terminal',     label: 'Airport Terminal',   type: 'select', half: true,
          options: ['Terminal 1 (DXB)', 'Terminal 2 (DXB)', 'Terminal 3 (DXB)', 'Al Maktoum (DWC)', 'Zayed AUH Terminal A', 'Sharjah (SHJ)', 'Private Jet / FBO Terminal'],
          showIf: (f) => String(f.tripType || '').includes('Airport') },
        { key: 'returnRequired', label: 'Add Return Transfer', type: 'toggle',
          hint: 'Schedule a paired return journey with the same chauffeur class' },
        { key: 'endDate',      label: 'Return Date',        type: 'date', half: true, required: true, showIf: (f) => !!f.returnRequired },
        { key: 'returnTime',   label: 'Return Pickup Time', type: 'time', half: true, required: true, showIf: (f) => !!f.returnRequired },
        { key: 'returnFrom',   label: 'Return Pickup Address', type: 'text', placeholder: 'Leave blank if returning from drop-off location',
          showIf: (f) => !!f.returnRequired },
      ],
    },
    {
      title: 'Booker (EA) & VIP Passenger Details',
      icon: '⭐',
      fields: [
        { key: 'bookingFor',     label: 'Booking For',              type: 'select', required: true, half: true,
          options: ['Myself', 'Executive / Colleague', 'VIP Client / External Guest'] },
        { key: 'vipLevel',       label: 'VIP / Protocol Tier',      type: 'select', required: true, half: true,
          options: ['C-Suite / Board', 'Senior Management', 'Government Official', 'Client / Guest', 'Standard Executive'] },
        { key: 'requestorName',  label: 'Booker / EA Full Name',    type: 'text',   placeholder: 'Your full name',          required: true, half: true },
        { key: 'requestorEmail', label: 'Booker Email (Invoice & Updates)', type: 'email', placeholder: 'ea@company.com',   required: true, half: true },
        { key: 'phone',          label: 'Booker Mobile Number',     type: 'tel',    placeholder: '+971 50 000 0000',        required: true, half: true },
        { key: 'passengerName',  label: 'Lead Passenger Full Name', type: 'text',   placeholder: 'Traveller name for manifest & signboard', required: true, half: true,
          showIf: (f) => f.bookingFor !== 'Myself' },
        { key: 'passengerPhone', label: 'Passenger Mobile (Chauffeur Tracking)', type: 'tel', placeholder: '+971 50 000 0000', half: true,
          showIf: (f) => f.bookingFor !== 'Myself' },
        { key: 'paxCount',       label: 'No. of Passengers',        type: 'number', placeholder: '1', required: true, half: true, unit: 'pax' },
        { key: 'luggageCount',   label: 'Checked Luggage Pieces',   type: 'number', placeholder: '2', required: true, half: true, unit: 'bags' },
      ],
    },
    {
      title: 'Chauffeur Protocol & Meet & Greet',
      icon: '🎁',
      fields: [
        { key: 'meetAndGreet',      label: 'Arrivals Hall Meet & Greet with Name Board', type: 'toggle',
          hint: 'Chauffeur waits inside arrivals hall with digital/printed guest signboard' },
        { key: 'signboardName',     label: 'Greeting Signboard Text', type: 'text', placeholder: 'e.g. Mr. Al-Mansoori / ACME Board', half: true,
          showIf: (f) => !!f.meetAndGreet },
        { key: 'chauffeurLanguage', label: 'Chauffeur Language Preference', type: 'select', half: true,
          options: ['English', 'Arabic & English', 'No Preference'] },
        { key: 'extras',            label: 'In-Vehicle Preferences', type: 'select', half: true,
          options: ['Standard (Mineral Water & WiFi)', 'Cold Towels & Refreshments', 'Newspapers / Business Press', 'Flowers / VIP Welcome Pack', 'Child / Booster Seat', 'Quiet Ride Requested'] },
        { key: 'notes',             label: 'Chauffeur & Protocol Instructions', type: 'textarea',
          placeholder: 'VIP gate entry, dress code, multi-stop roadshow schedule, security escort instructions…' },
      ],
    },
  ],

  // ── LOGISTICS (Benchmarked vs Freightos, Flexport, DHL, Uber Freight) ────
  LOGISTICS: [
    {
      title: 'Shipper, Consignee & Commercial Reference',
      icon: '🏢',
      fields: [
        { key: 'companyName',      label: 'Shipper Company Name',     type: 'text',  placeholder: 'Sending company / shipper',  required: true, half: true },
        { key: 'requestorName',    label: 'Shipper Contact Person',   type: 'text',  placeholder: 'Full name',                  required: true, half: true },
        { key: 'requestorEmail',   label: 'Shipper Email',            type: 'email', placeholder: 'logistics@company.com',      required: true, half: true },
        { key: 'phone',            label: 'Shipper Phone / Dock Tel', type: 'tel',   placeholder: '+971 50 000 0000',           required: true, half: true },
        { key: 'consigneeCompany', label: 'Consignee / Receiver Company', type: 'text', placeholder: 'Receiving company / store', required: true, half: true },
        { key: 'consigneeContact', label: 'Consignee Contact & Phone', type: 'text', placeholder: 'Receiver name & +971 5X…',   required: true, half: true },
        { key: 'poReference',      label: 'PO / Manifest / Shipment Ref', type: 'text', placeholder: 'e.g. PO-2026-8841 or MAN-DXB-09', half: true },
        { key: 'incoterms',        label: 'Incoterms',                type: 'select', half: true,
          options: ['Domestic UAE (N/A)', 'EXW – Ex Works', 'FOB – Free On Board', 'CIF – Cost, Insurance & Freight', 'DAP – Delivered At Place', 'DDP – Delivered Duty Paid'] },
      ],
    },
    {
      title: 'Origin, Destination & Dock Schedule',
      icon: '📍',
      fields: [
        { key: 'shipmentType',       label: 'Shipment Load Mode', type: 'select', required: true, half: true,
          options: ['FTL – Full Truck Load', 'LTL – Less than Truck Load', 'FCL – Full Container Load', 'LCL – Less than Container Load', 'REEFER – Temperature Controlled', 'SPECIAL – Oversized / Project Cargo'] },
        { key: 'originFacilityType', label: 'Origin Facility Type', type: 'select', required: true, half: true,
          options: ['Commercial Warehouse (With Dock)', 'Port / Free Zone Terminal', 'Retail Store / Mall Dock', 'Construction / Open Site (No Dock)'] },
        { key: 'origin',             label: 'Origin Warehouse / Collection Address', type: 'text', placeholder: 'Warehouse, JAFZA gate, or pickup facility', required: true },
        { key: 'destination',        label: 'Consignee Delivery Facility Address',   type: 'text', placeholder: 'Final receiving warehouse or dock address', required: true },
        { key: 'destFacilityType',   label: 'Destination Facility Type', type: 'select', required: true, half: true,
          options: ['Commercial Warehouse (With Dock)', 'Port / Free Zone Terminal', 'Retail Store / Mall Dock', 'Construction / Open Site (No Dock)'] },
        { key: 'startDate',          label: 'Cargo Ready / Pickup Date', type: 'date', required: true, half: true },
        { key: 'pickupTime',         label: 'Pickup Dock Time',          type: 'time', required: true, half: true },
        { key: 'deliveryDate',       label: 'Requested Delivery Date',   type: 'date', required: true, half: true },
        { key: 'deliveryTime',       label: 'Delivery Window',           type: 'select', half: true,
          options: ['Anytime', '06:00–10:00', '10:00–14:00', '14:00–18:00', '18:00–22:00', 'Dock Appointment Required'] },
        { key: 'multiStopRequired',  label: 'Multi-Stop / Milk-Run Route Planning', type: 'toggle',
          hint: 'Enable to add intermediate pickup or drop-off docks with LTL consolidation' },
        { key: 'recurringFreight',   label: 'Recurring Standing Freight Schedule', type: 'toggle',
          hint: 'Enable for scheduled weekly/daily contract runs with volume pricing' },
        { key: 'bulkManifestUpload', label: 'Upload Bulk Multi-Store Manifest (CSV)', type: 'toggle',
          hint: 'Enable to batch-ingest and auto-cluster multiple store consignments' },
      ],
    },
    {
      title: 'Cargo, Packaging & Cold-Chain Specs',
      icon: '📦',
      fields: [
        { key: 'cargoType',          label: 'Commodity Category',       type: 'select', required: true, half: true,
          options: ['General Goods', 'Fragile / Breakable', 'Perishable / Cold Chain', 'Pharmaceuticals (GDP)', 'Hazardous Materials', 'Heavy Machinery', 'Electronics', 'Automotive Parts', 'Retail / E-Commerce', 'Furniture', 'Documents / Parcels'] },
        { key: 'packagingType',      label: 'Packaging Type',           type: 'select', required: true, half: true,
          options: ['Euro Pallets (120×80cm)', 'ISO Pallets (120×100cm)', 'Cartons / Boxes', 'Wooden Crates', 'Drums / IBCs', '20ft / 40ft Container', 'Loose / Bulk'] },
        { key: 'cargo',              label: 'Commodity Description',    type: 'text',   placeholder: 'Clear description of goods for BOL & customs', required: true },
        { key: 'pallets',            label: 'Pieces / Pallet Count',    type: 'number', placeholder: '8',    required: true, half: true, unit: 'units' },
        { key: 'weight',             label: 'Total Gross Weight',       type: 'number', placeholder: '1200', required: true, half: true, unit: 'kg' },
        { key: 'cbm',                label: 'Total Volume (CBM)',       type: 'number', placeholder: '6.5',  half: true, unit: 'm³' },
        { key: 'dimensions',         label: 'Unit Dimensions (L×W×H)',  type: 'text',   placeholder: '120 × 80 × 140 cm', half: true },
        { key: 'cargoValueAed',      label: 'Declared Cargo Value',     type: 'number', placeholder: '50000', half: true, unit: 'AED' },
        { key: 'stackable',          label: 'Cargo is Stackable',       type: 'toggle',
          hint: 'Disable if pallets/crates cannot be double-stacked in trailer' },
        { key: 'tempControlled',     label: 'Temperature-Controlled (Reefer / Cold Chain)', type: 'toggle',
          hint: 'Requires active refrigeration and pre-cooled cargo box' },
        { key: 'tempRange',          label: 'Target Temperature Band',  type: 'select', required: true, half: true,
          options: ['Frozen (-20°C to -18°C)', 'Chilled Food (+2°C to +8°C)', 'Pharma Controlled (+15°C to +25°C)', 'Deep Freeze (-25°C)', 'Custom Range (Specify in Notes)'],
          showIf: (f) => !!f.tempControlled },
        { key: 'tempLoggerRequired', label: 'Continuous Temperature Data Logger (GDP Audit)', type: 'toggle',
          hint: 'Attach calibrated BLE temperature log to delivery certificate',
          showIf: (f) => !!f.tempControlled },
      ],
    },
    {
      title: 'Dangerous Goods (ADR / IMDG)',
      icon: '⚠️',
      fields: [
        { key: 'isHazmat',          label: 'Shipment Contains Dangerous Goods (Hazmat)', type: 'toggle',
          hint: 'Enable if classified under ADR / IMDG / UAE Civil Defence regulations' },
        { key: 'unNumber',          label: 'UN Number',            type: 'text',   placeholder: 'e.g. UN1950', required: true, half: true, showIf: (f) => !!f.isHazmat },
        { key: 'adrClass',          label: 'ADR / IMDG Class',     type: 'select', required: true, half: true, showIf: (f) => !!f.isHazmat,
          options: ['Class 1 – Explosives', 'Class 2 – Gases', 'Class 3 – Flammable Liquids', 'Class 4 – Flammable Solids', 'Class 5 – Oxidizing Substances', 'Class 6 – Toxic & Infectious', 'Class 7 – Radioactive', 'Class 8 – Corrosives', 'Class 9 – Misc. Dangerous Goods'] },
        { key: 'packingGroup',      label: 'Packing Group',        type: 'select', half: true, showIf: (f) => !!f.isHazmat,
          options: ['PG I – Great Danger', 'PG II – Medium Danger', 'PG III – Minor Danger', 'N/A'] },
        { key: 'hazmatDescription', label: 'Proper Shipping Name', type: 'text',   placeholder: 'Official technical name per ADR / IMDG', half: true, showIf: (f) => !!f.isHazmat },
        { key: 'msdsAvailable',     label: 'MSDS / SDS Document Ready for Handover', type: 'toggle', showIf: (f) => !!f.isHazmat,
          hint: 'Material Safety Data Sheet must accompany the driver at collection' },
      ],
    },
    {
      title: 'Accessorials, Customs & Handling',
      icon: '⚙️',
      fields: [
        { key: 'liftgateRequired', label: 'Tail-Lift / Liftgate Truck Required', type: 'toggle',
          hint: 'Required when origin or destination has no raised loading dock' },
        { key: 'driverAssist',     label: 'Driver Loading / Unloading Assistance', type: 'toggle',
          hint: 'Request helper or pallet-jack assist at dock' },
        { key: 'urgentDelivery',   label: 'Expedited / Dedicated Priority Transit', type: 'toggle',
          hint: 'Direct non-stop point-to-point dispatch' },
        { key: 'podRequired',      label: 'Electronic Proof of Delivery (e-POD) Required', type: 'toggle',
          hint: 'Capture receiver signature & timestamp upon delivery' },
        { key: 'insuranceReq',     label: 'All-Risk Transit Cargo Insurance', type: 'toggle',
          hint: 'Insure shipment against loss/damage based on declared value' },
        { key: 'customsClearance', label: 'Cross-Border / Free-Zone Customs Brokerage', type: 'toggle',
          hint: 'Include Dubai Customs / GCC border declaration & HS clearance' },
        { key: 'hsCode',           label: 'HS Code (Harmonized System)', type: 'text', placeholder: 'e.g. 8471.30', half: true,
          showIf: (f) => !!f.customsClearance },
        { key: 'hsDescription',    label: 'HS Customs Description',      type: 'text', placeholder: 'Commodity customs declaration', half: true,
          showIf: (f) => !!f.customsClearance },
        { key: 'notes',            label: 'Dock Restrictions & Special Handling Notes', type: 'textarea',
          placeholder: 'Gate pass pre-approval, fragile handling, forklift availability, BOL instructions…' },
      ],
    },
  ],

  // ── SCHOOL_BUS (Benchmarked vs STS, Emirates Transport, Salama, Zum) ─────
  SCHOOL_BUS: [
    {
      title: 'Parent / Guardian Details',
      icon: '👨‍👩‍👧',
      fields: [
        { key: 'requestorName',    label: 'Parent / Guardian Full Name', type: 'text',  placeholder: 'Full legal name', required: true, half: true },
        { key: 'relationship',     label: 'Relationship to Student',     type: 'select', required: true, half: true,
          options: ['Father', 'Mother', 'Legal Guardian', 'Other'] },
        { key: 'parentEmiratesId', label: 'Parent Emirates ID No.',      type: 'text',  placeholder: '784-XXXX-XXXXXXX-X', required: true, half: true },
        { key: 'requestorEmail',   label: 'Parent Email Address',        type: 'email', placeholder: 'parent@email.com', required: true, half: true },
        { key: 'phone',            label: 'Primary Mobile (WhatsApp & App)', type: 'tel', placeholder: '+971 50 000 0000', required: true, half: true },
        { key: 'alternatePhone',   label: 'Secondary Parent Mobile',     type: 'tel',   placeholder: '+971 55 000 0000', half: true },
      ],
    },
    {
      title: 'Student Profile',
      icon: '👧',
      fields: [
        { key: 'studentName',   label: 'Student Full Legal Name',  type: 'text',   placeholder: 'As per school record / Emirates ID', required: true, half: true },
        { key: 'studentId',     label: 'School Admission / Student ID', type: 'text', placeholder: 'e.g. STU-2026-1042', required: true, half: true },
        { key: 'studentGrade',  label: 'Grade / Year & Section',   type: 'text',   placeholder: 'e.g. Grade 5-B, Year 7, FS2', required: true, half: true },
        { key: 'studentDob',    label: 'Student Date of Birth',    type: 'date',   required: true, half: true },
        { key: 'studentGender', label: 'Student Gender',           type: 'select', required: true, half: true,
          options: ['Male', 'Female'] },
      ],
    },
    {
      title: 'School & Enrollment Term',
      icon: '🏫',
      fields: [
        { key: 'schoolArea',   label: 'School Campus / Area',  type: 'text',   placeholder: 'e.g. Al Barsha, Jumeirah, Khalifa City', required: true, half: true },
        { key: 'curriculum',   label: 'Curriculum',            type: 'select', half: true,
          options: ['UAE National', 'British (KHDA / ADEK)', 'American', 'IB (International Baccalaureate)', 'Indian CBSE', 'Indian ICSE', 'Other'] },
        { key: 'academicTerm', label: 'Enrollment Term',       type: 'select', required: true, half: true,
          options: ['Full Academic Year', 'Term 1 (Autumn)', 'Term 2 (Winter)', 'Term 3 (Spring)'] },
        { key: 'startDate',    label: 'Transport Start Date',  type: 'date',   required: true, half: true },
        { key: 'endDate',      label: 'Expected End Date (Optional)', type: 'date', half: true,
          hint: 'Leave blank for full academic year enrollment' },
      ],
    },
    {
      title: 'Home Residence & Route Mapping',
      icon: '📍',
      fields: [
        { key: 'emirate',      label: 'Emirate', type: 'select', required: true, half: true,
          options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'] },
        { key: 'makaniNumber', label: 'Makani Number / Nearest Landmark', type: 'text',
          placeholder: '10-digit Dubai Makani or community gate landmark', half: true,
          hint: 'Pinpoints exact villa / building for RTA bus stop optimization' },
        { key: 'origin',       label: 'Home Pickup Address (Community / Building / Villa)', type: 'text',
          placeholder: 'Community, street, building name & villa/flat number', required: true },
        { key: 'destination',  label: 'School Name', type: 'text',
          placeholder: 'Full school name & campus', required: true },
        { key: 'pickupTime',   label: 'Morning Readiness Window', type: 'time', half: true,
          showIf: (f) => f.vehicleCategory !== 'Afternoon Drop-off Only' && f.vehicleCategory !== 'After-School Activity Bus' },
        { key: 'returnTime',   label: 'School Dismissal Time',    type: 'time', half: true,
          showIf: (f) => f.vehicleCategory !== 'Morning Pickup Only' },
      ],
    },
    {
      title: 'Authorized Drop-Off Receiver & Emergency Contact',
      icon: '🆘',
      fields: [
        { key: 'authorizedReceiverName',     label: 'Authorized Drop-Off Receiver Name', type: 'text',
          placeholder: 'Adult authorized to meet student at bus stop', required: true, half: true },
        { key: 'authorizedReceiverRelation', label: 'Receiver Authorization Type', type: 'select', required: true, half: true,
          options: ['Parent', 'Nanny / Caregiver', 'Grandparent', 'Older Sibling (14+)', 'Self-Disembark Authorized (Grade 6+ Only)'] },
        { key: 'emergencyContact',           label: 'Emergency Backup Contact Name', type: 'text',
          placeholder: 'Alternate person if parents are unreachable', required: true, half: true },
        { key: 'emergencyPhone',             label: 'Emergency Backup Mobile', type: 'tel',
          placeholder: '+971 50 000 0000', required: true, half: true },
      ],
    },
    {
      title: 'Medical, Special Needs & RTA Safety Consent',
      icon: '⚕️',
      fields: [
        { key: 'specialNeeds',      label: 'Mobility / Supervision Needs', type: 'select', half: true,
          options: ['None', 'Wheelchair Lift Bus', 'Extra Bus Attendant Supervision', 'Vision Impaired', 'Hearing Impaired', 'Behavioural Support', 'Other'] },
        { key: 'epiPenOnBoard',     label: 'Student Carries EpiPen / Emergency Medication', type: 'toggle',
          hint: 'Driver and female bus attendant will be briefed prior to first boarding' },
        { key: 'medicalConditions', label: 'Medical Conditions & Severe Allergies', type: 'textarea',
          placeholder: 'Asthma, nut allergy, diabetes, motion sickness — confidentially shared with assigned bus attendant' },
        { key: 'busSafetyCodeAccepted', label: 'I accept the RTA School Bus Safety & Student Behaviour Code *', type: 'toggle',
          required: true,
          hint: 'Mandatory declaration: student must wear seatbelt at all times; guardian must be at stop 5 mins before ETA for KG–Grade 5' },
        { key: 'notes',             label: 'Community Gate Pass / Driver Notes', type: 'textarea',
          placeholder: 'Compound access code, preferred pickup gate, sibling on same bus…' },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state & domain defaults
// ─────────────────────────────────────────────────────────────────────────────

type FormData = Record<string, string | boolean | number>;

const EMPTY_FORM: FormData = {
  requestorName: '', requestorEmail: '', phone: '',
  emiratesId: '', licenseNo: '', licenseExpiry: '', driverDob: '', licenseCountry: '', idpRequired: false,
  vehicleCategory: '', transmission: '', fuelType: '', insurancePackage: '', mileagePlan: '',
  additionalDriver: false, childSeat: '', gpsUnit: false, crossBorderPermit: false,
  startDate: '', endDate: '', pickupTime: '', returnTime: '',
  origin: '', destination: '', sameReturnLoc: true,
  customerType: '', companyName: '', jobTitle: '', tradeNo: '', vatNo: '',
  leaseType: '', quantity: '', leaseDuration: '', annualMileage: '', deliveryEmirate: '', monthlyBudget: '',
  preferredBrand: '', color: '',
  insuranceIncluded: false, maintenanceIncluded: false, tyresIncluded: false,
  replacementVehicleIncluded: false, roadsideAssistance: false, salikIncluded: false, telematicsIncluded: false,
  department: '', employeeId: '', shiftType: '', workDays: '', passType: '', commuteDirection: '', preferredStopLandmark: '',
  accessibilityNeeds: '', genderPreference: '',
  bookingFor: '', passengerName: '', passengerPhone: '', vipLevel: '', paxCount: '', luggageCount: '',
  tripType: '', charterHours: '', flightNo: '', terminal: '', returnRequired: false, returnFrom: '',
  meetAndGreet: false, signboardName: '', chauffeurLanguage: '', extras: '',
  consigneeCompany: '', consigneeContact: '', poReference: '', incoterms: '',
  shipmentType: '', originFacilityType: '', destFacilityType: '',
  multiStopRequired: false, recurringFreight: false, bulkManifestUpload: false,
  cargoType: '', packagingType: '', cargo: '', weight: '', cbm: '', dimensions: '', pallets: '',
  cargoValueAed: '', stackable: false, tempControlled: false, tempRange: '', tempLoggerRequired: false,
  isHazmat: false, unNumber: '', adrClass: '', packingGroup: '', hazmatDescription: '', msdsAvailable: false,
  liftgateRequired: false, driverAssist: false, urgentDelivery: false,
  podRequired: false, insuranceReq: false, customsClearance: false, hsCode: '', hsDescription: '',
  deliveryDate: '', deliveryTime: '',
  parentEmiratesId: '', alternatePhone: '',
  studentName: '', studentGrade: '', studentDob: '', studentGender: '', studentId: '',
  schoolArea: '', curriculum: '', academicTerm: '', emirate: '', makaniNumber: '',
  authorizedReceiverName: '', authorizedReceiverRelation: '', relationship: '',
  medicalConditions: '', specialNeeds: '', epiPenOnBoard: false, busSafetyCodeAccepted: false,
  emergencyContact: '', emergencyPhone: '',
  schoolBillingPlan: '',
  renterAccountType: '', personalPaymentMethod: '',
  costCenter: '', projectCode: '', billingMethod: '', budgetStatus: '',
  notes: '',
};

function getDefaultFormForService(serviceType: ServiceType): FormData {
  switch (serviceType) {
    case 'RENTAL':
      return {
        ...EMPTY_FORM,
        renterAccountType: 'PERSONAL',
        personalPaymentMethod: 'Credit Card at Counter (Security Deposit Required)',
        vehicleCategory: 'Mid-Size',
        sameReturnLoc: true,
        licenseCountry: 'United Arab Emirates',
        insurancePackage: 'Basic CDW (Standard Excess)',
        mileagePlan: 'Standard (250 km/day)',
        costCenter: '',
        billingMethod: 'PERSONAL_CARD_AT_COUNTER',
      };
    case 'LEASING':
      return {
        ...EMPTY_FORM,
        leaseType: 'Operating Lease (Full-Service)',
        customerType: 'Corporate / Enterprise',
        vehicleCategory: 'Mid-Size Sedan',
        quantity: 3,
        leaseDuration: '36 months',
        annualMileage: '30,000 km/yr',
        deliveryEmirate: 'Dubai',
        insuranceIncluded: true,
        maintenanceIncluded: true,
        replacementVehicleIncluded: true,
        roadsideAssistance: true,
        costCenter: 'CC-OPS-3003',
        billingMethod: 'CORPORATE_ACCOUNT',
      };
    case 'STAFF_TRANSPORT':
      return {
        ...EMPTY_FORM,
        vehicleCategory: 'Scheduled Shuttle Pass',
        commuteDirection: 'Two-Way (Home ↔ Workplace)',
        passType: 'Regular Standing Pass',
        workDays: 'Monday–Friday',
        costCenter: 'CC-HR-5005',
        billingMethod: 'COST_CENTER_DIRECT',
      };
    case 'EXECUTIVE':
      return {
        ...EMPTY_FORM,
        vehicleCategory: 'Luxury Sedan',
        bookingFor: 'Myself',
        tripType: 'City Transfer',
        vipLevel: 'Senior Management',
        paxCount: 1,
        luggageCount: 2,
        costCenter: 'CC-EXEC-1001',
        billingMethod: 'CORPORATE_ACCOUNT',
      };
    case 'LOGISTICS':
      return {
        ...EMPTY_FORM,
        vehicleCategory: '3-Ton Box Truck',
        shipmentType: 'FTL – Full Truck Load',
        packagingType: 'Euro Pallets (120×80cm)',
        incoterms: 'Domestic UAE (N/A)',
        originFacilityType: 'Commercial Warehouse (With Dock)',
        destFacilityType: 'Commercial Warehouse (With Dock)',
        stackable: true,
        podRequired: true,
        costCenter: 'CC-OPS-3003',
        billingMethod: 'CORPORATE_ACCOUNT',
      };
    case 'SCHOOL_BUS':
      return {
        ...EMPTY_FORM,
        vehicleCategory: 'Two-Way Full Service',
        academicTerm: 'Full Academic Year',
        emirate: 'Dubai',
        schoolBillingPlan: 'Termly Tuition Invoice',
        billingMethod: 'PARENT_TERMLY_INVOICE',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: rental days, age check, leasing/school estimates, payload builder
// ─────────────────────────────────────────────────────────────────────────────

function computeRentalDays(startDate?: string, endDate?: string): number {
  if (!startDate || !endDate) return 1;
  const s = new Date(startDate).getTime();
  const e = new Date(endDate).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 1;
  return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
}

function computeDriverAge(dob?: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function computeRentalAddOns(form: FormData, days: number): number {
  let perDay = 0;
  const ins = String(form.insurancePackage || '');
  if (ins.includes('Super CDW')) perDay += 45;
  else if (ins.includes('Full Protection')) perDay += 75;
  if (form.additionalDriver) perDay += 35;
  if (form.childSeat && form.childSeat !== 'None') perDay += 25;
  if (form.gpsUnit) perDay += 20;
  return perDay * days;
}

function parseLeaseMonths(duration?: string): number {
  const m = String(duration || '36 months').match(/(\d+)/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 36;
}

function computeLeasingEstimate(form: FormData) {
  const qty = Math.max(1, Number(form.quantity) || 1);
  const months = parseLeaseMonths(form.leaseDuration as string);
  const baseQuote = calculateInstantQuotation({
    serviceType: 'LEASING',
    vehicleCategory: (form.vehicleCategory as string) || 'Mid-Size Sedan',
    quantity: 1,
  });
  let perVehicle = baseQuote.baseFareAed;
  if (form.leaseType === 'Flexi-Lease (3–11 Months)') perVehicle = Math.round(perVehicle * 1.15);
  if (form.leaseType === 'EV / Green Fleet Lease') perVehicle = Math.round(perVehicle * 1.12);
  if (form.maintenanceIncluded) perVehicle += 180;
  if (form.insuranceIncluded) perVehicle += 220;
  if (form.tyresIncluded) perVehicle += 95;
  if (form.replacementVehicleIncluded) perVehicle += 140;
  if (form.telematicsIncluded) perVehicle += 65;

  const monthlyNet = perVehicle * qty;
  const monthlyVat = Math.round(monthlyNet * 0.05 * 100) / 100;
  const monthlyTotal = Math.round((monthlyNet + monthlyVat) * 100) / 100;
  const contractTotal = Math.round(monthlyTotal * months * 100) / 100;
  return { qty, months, perVehicle, monthlyNet, monthlyVat, monthlyTotal, contractTotal };
}

function computeSchoolBusEstimate(form: FormData) {
  const plan = (form.vehicleCategory as string) || 'Two-Way Full Service';
  const baseQuote = calculateInstantQuotation({
    serviceType: 'SCHOOL_BUS',
    vehicleCategory: plan,
  });
  const billingPlan = (form.schoolBillingPlan as string) || 'Termly Tuition Invoice';
  const discountRate = billingPlan.includes('Annual') ? 0.05 : 0;
  const netMonthly = Math.round(baseQuote.baseFareAed * (1 - discountRate) * 100) / 100;
  const vatAmount = Math.round(netMonthly * 0.05 * 100) / 100;
  const totalMonthly = Math.round((netMonthly + vatAmount) * 100) / 100;
  return { plan, billingPlan, discountRate, netMonthly, vatAmount, totalMonthly };
}

function buildPayload(
  serviceType: string,
  form: FormData,
  attachments: UploadedBookingDocument[] = []
) {
  const ref = `${serviceType.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;

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

  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (['requestorName', 'requestorEmail', 'startDate', 'endDate', 'vehicleCategory', 'notes'].includes(k)) continue;
    if (v !== '' && v !== false && v !== 0 && v !== undefined) meta[k] = v;
  }
  if (form.notes) meta.extraNotes = form.notes;
  if (attachments.length > 0) meta.attachments = attachments;

  return { ...core, notes: JSON.stringify(meta), _ref: ref };
}

// ─────────────────────────────────────────────────────────────────────────────
// Form field renderers
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = formInputCls;
const labelCls = 'block text-xs font-semibold text-[var(--text-main)] mb-1.5';

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
      <div className="flex items-start gap-3 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(field.key, !value)}
          className={`relative mt-0.5 flex-shrink-0 w-10 h-6 rounded-full transition-colors ${
            value ? 'bg-blue-600 shadow-sm' : 'bg-slate-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              value ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
        <div>
          <p className="text-sm font-semibold text-[var(--text-main)]">{field.label}</p>
          {field.hint && <p className="text-xs text-[var(--text-muted)] mt-0.5">{field.hint}</p>}
        </div>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className={labelCls}>
          {field.label}
          {field.required && <span className="text-cyan-500 ml-0.5">*</span>}
        </label>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
          required={field.required}
          className={inputCls}
        >
          <option value="" className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
            — Select —
          </option>
          {field.options?.map((o) => (
            <option key={o} value={o} className="bg-[var(--bg-surface)] text-[var(--text-main)]">
              {o}
            </option>
          ))}
        </select>
        {field.hint && <p className="text-xs text-[var(--text-muted)] mt-1">{field.hint}</p>}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        <label className={labelCls}>
          {field.label}
          {field.required && <span className="text-cyan-500 ml-0.5">*</span>}
        </label>
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          rows={3}
          className={`${inputCls} resize-none`}
        />
        {field.hint && <p className="text-xs text-[var(--text-muted)] mt-1">{field.hint}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className="text-cyan-500 ml-0.5">*</span>}
        {field.unit && <span className="text-[var(--text-muted)] ml-1 normal-case font-normal">({field.unit})</span>}
      </label>
      <input
        type={field.type}
        value={String(value ?? '')}
        onChange={(e) => onChange(field.key, field.type === 'number' ? e.target.value : e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        min={field.type === 'number' ? 0 : undefined}
        className={inputCls}
      />
      {field.hint && <p className="text-xs text-[var(--text-muted)] mt-1">{field.hint}</p>}
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
  serviceType: string;
}) {
  const originField = section.fields.find((f) => f.key === 'origin');
  const destField = section.fields.find((f) => f.key === 'destination');
  const hasRoutePicker = !!originField;

  const fieldsToRender = section.fields.filter((f) => {
    if (hasRoutePicker && (f.key === 'origin' || f.key === 'destination')) return false;
    return true;
  });

  const visibleFields = fieldsToRender.filter((f) => !f.showIf || f.showIf(form));
  const hasRequired =
    hasRoutePicker || visibleFields.some((f) => f.required);

  const hideDestination =
    (serviceType === 'RENTAL' && !!form.sameReturnLoc) ||
    (hasRoutePicker && !destField);
  const destinationRequired =
    serviceType === 'EXECUTIVE' && ['Full Day', 'Multi-Day', 'Road Show'].includes(String(form.tripType || ''))
      ? false
      : hideDestination
        ? false
        : destField?.required !== undefined
          ? !!destField.required
          : true;

  const handleOriginChange = useCallback(
    (addr: string, coords?: { lat: number; lng: number }) => {
      onChange('origin', addr);
      if (coords) onChange('originCoords', JSON.stringify(coords));
    },
    [onChange]
  );

  const handleDestinationChange = useCallback(
    (addr: string, coords?: { lat: number; lng: number }) => {
      onChange('destination', addr);
      if (coords) onChange('destCoords', JSON.stringify(coords));
    },
    [onChange]
  );

  const handleRouteChange = useCallback(
    (stats: { distanceKm: number; durationMins: number; salikTollsAed: number }) => {
      onChange('distanceKm', stats.distanceKm);
      onChange('durationMins', stats.durationMins);
      onChange('salikTollsAed', stats.salikTollsAed);
    },
    [onChange]
  );

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
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-cyan-500/30 rounded-2xl overflow-hidden shadow-sm transition-all">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
            {getSectionVectorIcon(section.title)}
          </div>
          <h3 className="text-sm font-bold text-[var(--text-main)] tracking-wide">{section.title}</h3>
        </div>
        <span
          className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${
            hasRequired
              ? 'text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
              : 'text-[var(--text-muted)] bg-[var(--bg-main)] border-[var(--border-subtle)]'
          }`}
        >
          {hasRequired ? 'REQUIRED' : 'OPTIONAL'}
        </span>
      </div>

      {/* Fields */}
      <div className="p-5 space-y-4">
        {hasRoutePicker && (
          <InteractiveRoutePicker
            origin={(form.origin as string) || ''}
            destination={
              hideDestination
                ? (form.origin as string) || ''
                : (form.destination as string) || ''
            }
            originLabel={originField?.label || 'Pickup Location'}
            destinationLabel={destField?.label || 'Drop-off Location'}
            originPlaceholder={originField?.placeholder || 'Enter pickup address…'}
            destinationPlaceholder={destField?.placeholder || 'Enter destination address…'}
            hideDestination={hideDestination}
            destinationRequired={destinationRequired}
            onOriginChange={handleOriginChange}
            onDestinationChange={handleDestinationChange}
            onRouteChange={handleRouteChange}
          />
        )}

        {rows.map((row, ri) =>
          row.length === 2 ? (
            <div key={ri} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {row.map((f) => (
                <FieldRenderer key={f.key} field={f} value={form[f.key] ?? ''} onChange={onChange} />
              ))}
            </div>
          ) : (
            <FieldRenderer key={row[0].key} field={row[0]} value={form[row[0].key] ?? ''} onChange={onChange} />
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation summary renderer
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3">
      <span className="text-[10px] text-cyan-600 dark:text-cyan-300 uppercase tracking-wider font-semibold">{label}</span>
      <span className="text-sm text-[var(--text-main)] font-medium">{value}</span>
    </div>
  );
}

const SERVICE_META: Record<ServiceType, { title: string; icon: string; cta: string; confirmNote?: string }> = {
  RENTAL:          { title: 'Rent-a-Car',      icon: '🚗', cta: 'Confirm Rental Booking' },
  LEASING:         { title: 'Vehicle Leasing', icon: '📋', cta: 'Submit Lease Proposal Request',
    confirmNote: '📋 Your corporate fleet lease RFQ has been routed to our Leasing Desk for credit check & formal quotation.' },
  STAFF_TRANSPORT: { title: 'Staff Transport', icon: '🚌', cta: 'Submit Shuttle Registration',
    confirmNote: '🚌 Your staff transport registration has been routed to Bus Operations for stop mapping & boarding pass issuance.' },
  EXECUTIVE:       { title: 'Executive Vehicle', icon: '⭐', cta: 'Confirm Executive Booking' },
  LOGISTICS:       { title: 'Logistics Trip',  icon: '🚛', cta: 'Submit Freight Dispatch Request',
    confirmNote: '🚛 Your logistics shipment has been sent to the Dispatch Board for truck & driver allocation.' },
  SCHOOL_BUS:      { title: 'School Bus',      icon: '🏫', cta: 'Submit Student Enrollment',
    confirmNote: '🏫 Your student enrollment is under review by our RTA routing team. Parent tracking app credentials will be emailed once route & bus attendant are assigned.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main inner component
// ─────────────────────────────────────────────────────────────────────────────

function NewBookingInner() {
  const { hasModule, tenant } = usePermissions();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const [catalog, setCatalog] = useState<BookingCatalogCategory[] | null>(null);
  const touchedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/booking-portal/catalog', { cache: 'no-store' });
        const d = await res.json().catch(() => null);
        if (active && res.ok && d?.ok && Array.isArray(d.categories)) {
          setCatalog(d.categories);
        }
      } catch {
        // Fallback to built-in SERVICE_CARDS & SCHEMAS
      }
    })();
    return () => { active = false; };
  }, []);

  const visibleCards = useMemo(() => {
    const hasTenantModuleRestrictions = !!(tenant && tenant.enabledModules && tenant.enabledModules.length > 0);
    return buildDynamicServiceCards(SERVICE_CARDS, catalog, hasModule, hasTenantModuleRestrictions);
  }, [catalog, hasModule, tenant]);

  const initialType = (searchParams.get('type') ?? '').trim().toUpperCase();
  const [step, setStep] = useState<1 | 2 | 3>(initialType ? 2 : 1);
  const [serviceType, setServiceType] = useState<string>(initialType);
  const [form, setForm] = useState<FormData>(
    initialType && initialType in SCHEMAS ? getDefaultFormForService(initialType as ServiceType) : EMPTY_FORM
  );
  const [bookingRef, setBookingRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLiveAvailability, setShowLiveAvailability] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedBookingDocument[]>([]);

  const selectService = useCallback(
    (type: string) => {
      const cat = findCatalogCategoryForBookingType(catalog, type);
      const baseDefaults = type in SCHEMAS ? getDefaultFormForService(type as ServiceType) : { ...EMPTY_FORM };
      touchedKeysRef.current = new Set();
      setServiceType(type);
      setForm(mergeCatalogDefaults(type, baseDefaults, cat));
      setUploadedDocs([]);
      setShowLiveAvailability(false);
      setError('');
      setStep(2);
    },
    [catalog]
  );

  // When the live catalogue loads asynchronously after mount, apply tenant default values
  // to any fields the user has not edited yet.
  useEffect(() => {
    if (!catalog || !serviceType) return;
    const cat = findCatalogCategoryForBookingType(catalog, serviceType);
    if (!cat || !cat.defaultValues || Object.keys(cat.defaultValues).length === 0) return;
    const baseDefaults = serviceType in SCHEMAS ? getDefaultFormForService(serviceType as ServiceType) : { ...EMPTY_FORM };
    const merged = mergeCatalogDefaults(serviceType, baseDefaults, cat);
    setForm((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [k, v] of Object.entries(merged)) {
        if (touchedKeysRef.current.has(k)) continue;
        if (cat.defaultValues[k] !== undefined || (serviceType === 'RENTAL' && k === 'renterAccountType' && cat.defaultValues.renterAccountType !== undefined)) {
          if (next[k] !== v) {
            next[k] = v;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [catalog, serviceType]);

  useEffect(() => {
    if (visibleCards.length === 0) return;
    if (initialType && visibleCards.some((c) => c.type === initialType)) {
      if (serviceType !== initialType || step !== 2) {
        selectService(initialType);
      }
    } else if (visibleCards.length === 1 && step === 1) {
      selectService(visibleCards[0].type);
    } else if (initialType && catalog && !visibleCards.some((c) => c.type === initialType)) {
      setServiceType('');
      setStep(1);
    }
  }, [initialType, visibleCards, catalog, selectService, serviceType, step]);

  const onChange = useCallback((k: string, v: string | boolean | number) => {
    touchedKeysRef.current.add(k);
    setForm((prev) => ({ ...prev, [k]: v }));
  }, []);

  // Derived domain calculations
  const rentalDays = useMemo(
    () => (serviceType === 'RENTAL' ? computeRentalDays(form.startDate as string, form.endDate as string) : 1),
    [serviceType, form.startDate, form.endDate]
  );

  const rentalAddOnsAed = useMemo(
    () => (serviceType === 'RENTAL' ? computeRentalAddOns(form, rentalDays) : 0),
    [serviceType, form, rentalDays]
  );

  const driverAge = useMemo(
    () => (serviceType === 'RENTAL' ? computeDriverAge(form.driverDob as string) : null),
    [serviceType, form.driverDob]
  );

  const leasingEst = useMemo(
    () => (serviceType === 'LEASING' ? computeLeasingEstimate(form) : null),
    [serviceType, form]
  );

  const schoolBusEst = useMemo(
    () => (serviceType === 'SCHOOL_BUS' ? computeSchoolBusEstimate(form) : null),
    [serviceType, form]
  );

  const isPersonalRental =
    serviceType === 'RENTAL' && form.renterAccountType !== 'CORPORATE';

  const personalRentalEst = useMemo(() => {
    if (!isPersonalRental) return null;
    return calculateInstantQuotation({
      serviceType: 'RENTAL',
      vehicleCategory: (form.vehicleCategory as string) || 'Mid-Size',
      rentalDays,
      addOnsAed: rentalAddOnsAed,
    });
  }, [isPersonalRental, form.vehicleCategory, rentalDays, rentalAddOnsAed]);

  const logisticsUploadSlots = useMemo<DocumentUploadSlot[]>(
    () => [
      {
        docType: 'commercial-invoice',
        label: 'Commercial Invoice',
        description: 'PDF, XLSX, DOCX, or Image (for shipper & customs valuation)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc',
        maxMb: 15,
      },
      {
        docType: 'packing-list',
        label: 'Packing List / Cargo Manifest',
        description: 'PDF, XLSX, CSV, or Image (itemized pallet weights & dimensions)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.txt',
        maxMb: 15,
      },
      {
        docType: 'msds',
        label: 'MSDS / Dangerous Goods Sheet',
        description: 'Material Safety Data Sheet (required when Hazmat is declared)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.docx,.doc',
        maxMb: 15,
        highlighted: !!form.isHazmat,
        highlightNote: 'Hazmat declared — attach official MSDS / SDS document for carrier safety clearance',
      },
      {
        docType: 'customs-permit',
        label: 'BOL Instructions / Customs Permit',
        description: 'Bill of Lading instructions, POA, or GCC import/export permit',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.docx,.doc',
        maxMb: 15,
        highlighted: !!form.customsClearance,
        highlightNote: 'Customs brokerage enabled — attach commercial permit or clearance instructions',
      },
    ],
    [form.isHazmat, form.customsClearance]
  );

  const schoolBusUploadSlots = useMemo<DocumentUploadSlot[]>(
    () => [
      {
        docType: 'student-photo',
        label: 'Student Passport-Style Photo',
        description: 'JPG, PNG, or WebP — printed on RFID bus boarding card & driver roster',
        accept: '.jpg,.jpeg,.png,.webp',
        maxMb: 5,
        imagePreview: true,
        highlighted: true,
      },
      {
        docType: 'parent-emirates-id',
        label: 'Parent / Guardian Emirates ID Copy',
        description: 'PDF, JPG, or PNG (front & back copy for RTA guardian verification)',
        accept: '.pdf,.jpg,.jpeg,.png,.webp',
        maxMb: 10,
      },
      {
        docType: 'medical-certificate',
        label: 'Medical / Allergy Action Plan',
        description: 'Doctor note or EpiPen protocol shared confidentially with bus attendant',
        accept: '.pdf,.jpg,.jpeg,.png,.webp',
        maxMb: 10,
        highlighted: !!form.epiPenOnBoard || !!String(form.medicalConditions || '').trim(),
        highlightNote: 'Medical condition / EpiPen noted — attach emergency care plan for bus attendant',
      },
    ],
    [form.epiPenOnBoard, form.medicalConditions]
  );

  // Sync calculated pricing into form for Personal RENTAL, LEASING, and SCHOOL_BUS
  useEffect(() => {
    if (isPersonalRental && personalRentalEst) {
      setForm((prev) => {
        if (
          prev.fareSubtotal === personalRentalEst.subtotalAed &&
          prev.vatAmount === personalRentalEst.vatAmountAed &&
          prev.totalFareAed === personalRentalEst.totalFareAed
        ) {
          return prev;
        }
        return {
          ...prev,
          fareSubtotal: personalRentalEst.subtotalAed,
          vatAmount: personalRentalEst.vatAmountAed,
          totalFareAed: personalRentalEst.totalFareAed,
          budgetStatus: 'WITHIN_POLICY',
        };
      });
    } else if (serviceType === 'LEASING' && leasingEst) {
      setForm((prev) => {
        if (
          prev.fareSubtotal === leasingEst.monthlyNet &&
          prev.vatAmount === leasingEst.monthlyVat &&
          prev.totalFareAed === leasingEst.monthlyTotal
        ) {
          return prev;
        }
        return {
          ...prev,
          fareSubtotal: leasingEst.monthlyNet,
          vatAmount: leasingEst.monthlyVat,
          totalFareAed: leasingEst.monthlyTotal,
          contractTotalAed: leasingEst.contractTotal,
          budgetStatus: leasingEst.monthlyTotal > 10000 ? 'EXCEEDS_POLICY' : 'WITHIN_POLICY',
        };
      });
    } else if (serviceType === 'SCHOOL_BUS' && schoolBusEst) {
      setForm((prev) => {
        if (
          prev.fareSubtotal === schoolBusEst.netMonthly &&
          prev.vatAmount === schoolBusEst.vatAmount &&
          prev.totalFareAed === schoolBusEst.totalMonthly
        ) {
          return prev;
        }
        return {
          ...prev,
          fareSubtotal: schoolBusEst.netMonthly,
          vatAmount: schoolBusEst.vatAmount,
          totalFareAed: schoolBusEst.totalMonthly,
          budgetStatus: 'WITHIN_POLICY',
        };
      });
    }
  }, [serviceType, isPersonalRental, personalRentalEst, leasingEst, schoolBusEst]);

  const card = visibleCards.find((c) => c.type === serviceType) || SERVICE_CARDS.find((c) => c.type === serviceType);
  const activeCatalogCat = useMemo(
    () => findCatalogCategoryForBookingType(catalog, serviceType),
    [catalog, serviceType]
  );
  const isBuiltinService = !!serviceType && serviceType in SCHEMAS;
  const schema: SectionDef[] = useMemo(
    () =>
      serviceType
        ? resolveDynamicBookingSchema(
            serviceType,
            isBuiltinService ? SCHEMAS[serviceType as ServiceType] : undefined,
            activeCatalogCat
          )
        : [],
    [serviceType, isBuiltinService, activeCatalogCat]
  );
  const primarySelector = isBuiltinService ? DOMAIN_PRIMARY_SELECTORS[serviceType as ServiceType] : null;
  const meta = useMemo(() => {
    if (!serviceType) return null;
    if (isBuiltinService) {
      const base = SERVICE_META[serviceType as ServiceType];
      return card ? { ...base, title: card.title, icon: card.icon } : base;
    }
    return {
      title: card?.title || activeCatalogCat?.title || serviceType,
      icon: card?.icon || activeCatalogCat?.icon || '🚐',
      cta: `Submit ${card?.title || activeCatalogCat?.title || 'Booking'} Request`,
      confirmNote: `Your ${(card?.title || serviceType).toLowerCase()} request has been logged and routed to operations.`,
    };
  }, [serviceType, isBuiltinService, card, activeCatalogCat]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Domain-specific compliance validations
    if (serviceType === 'RENTAL' && driverAge !== null && driverAge < 21) {
      setError('UAE RTA regulations require the primary rental driver to be at least 21 years old.');
      return;
    }
    if (serviceType === 'SCHOOL_BUS' && !form.busSafetyCodeAccepted) {
      setError('Please accept the mandatory RTA School Bus Safety & Student Behaviour Code before submitting.');
      return;
    }

    setLoading(true);
    try {
      const { _ref, ...payload } = buildPayload(serviceType, form, uploadedDocs);

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
    setUploadedDocs([]);
    setBookingRef('');
    setError('');
    setShowLiveAvailability(false);
  };

  const usesCorporateCostCenter =
    (serviceType === 'RENTAL' && !isPersonalRental) ||
    serviceType === 'STAFF_TRANSPORT' ||
    serviceType === 'EXECUTIVE' ||
    serviceType === 'LOGISTICS';

  const summarySubtotal = Number(form.fareSubtotal) || 0;
  const summaryVat = Number(form.vatAmount) || Math.round(summarySubtotal * 0.05 * 100) / 100;
  const summaryTotal = Number(form.totalFareAed) || Math.round((summarySubtotal + summaryVat) * 100) / 100;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8 min-h-screen text-[var(--text-main)] transition-colors duration-150">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">
            New Booking Intake
          </h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Domain-tailored booking & dispatch console across all mobility verticals
          </p>
        </div>

        {/* ── Progress stepper ── */}
        <div className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 shadow-sm">
          {(['Select Service', 'Booking Details', 'Confirmation'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      step > n
                        ? 'bg-emerald-500 text-white'
                        : step === n
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                    }`}
                  >
                    {step > n ? '✓' : n}
                  </div>
                  <span
                    className={`text-xs hidden md:block font-medium transition-colors ${
                      step >= n ? 'text-[var(--text-main)] font-semibold' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < 2 && (
                  <div
                    className={`w-6 h-0.5 rounded-full transition-all ${
                      step > n ? 'bg-emerald-500' : 'bg-black/10 dark:bg-[var(--bg-surface-hover)]'
                    }`}
                  />
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
            <h2 className="text-xl font-bold text-[var(--text-main)] tracking-wide">
              Select Transport Service Category
            </h2>
            <span className="text-xs font-mono text-[var(--text-muted)]">Step 1 of 3</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleCards.map((opt) => (
              <button
                key={opt.type}
                onClick={() => selectService(opt.type)}
                className="group relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-cyan-500/60 rounded-2xl p-6 text-left hover:shadow-md transition-all duration-200 hover:scale-[1.01] active:scale-100 flex flex-col justify-between space-y-4 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex items-center justify-center text-cyan-500 group-hover:scale-105 group-hover:border-cyan-500 transition-all">
                      {opt.type in SCHEMAS ? (
                        getServiceVectorIcon(opt.type, 'w-6 h-6 text-cyan-500')
                      ) : (
                        <span className="text-2xl leading-none">{opt.icon}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 px-2.5 py-1 rounded-full tracking-wider">
                      {opt.badge}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-[var(--text-main)] group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors">
                    {opt.title}
                  </h3>
                  <p className="text-[var(--text-muted)] text-xs mt-1.5 leading-relaxed">{opt.desc}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] text-xs text-cyan-600 dark:text-cyan-400 font-semibold group-hover:translate-x-1 transition-transform">
                  <span>Configure Booking</span>
                  <span>→</span>
                </div>
              </button>
            ))}
          </div>

          <Link
            href="/booking-portal/service-request"
            className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between rounded-2xl border border-dashed border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10 px-6 py-5 transition-colors"
          >
            <span>
              <span className="block text-base font-extrabold text-[var(--text-main)]">
                Need something fixed or arranged?
              </span>
              <span className="block text-xs text-[var(--text-muted)] mt-1">
                AC, cleaning, access cards, room setups and other service requests — tracked with an SLA.
              </span>
            </span>
            <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-300 whitespace-nowrap">
              Raise a service request →
            </span>
          </Link>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Step 2 — Domain-Specific Form
      ══════════════════════════════════════════════════════════════ */}
      {step === 2 && card && serviceType && (
        <div className="space-y-8">
          {/* Top Centered Capsule Navigation Pills */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 p-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm overflow-x-auto max-w-full">
              {visibleCards.map((opt) => {
                const isActive = serviceType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => selectService(opt.type)}
                    className={`px-6 py-2.5 rounded-full text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-main)]'
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
              {/* ── LEFT COLUMN (Service-Specific Selector + Domain Schema + Relevant Widgets) ── */}
              <div className="lg:col-span-8 space-y-6">
                {/* 1. Service-Specific Primary Selection Card (built-in 6 domains) */}
                {primarySelector && (
                <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--text-main)] tracking-wide">
                        {primarySelector.heading}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{primarySelector.subtitle}</p>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                      STEP 1
                    </span>
                  </div>

                  <div className={`grid ${primarySelector.gridCols} gap-3.5`}>
                    {primarySelector.options.map((opt) => {
                      const currentVal = String(form[primarySelector.fieldKey] || '');
                      const isSelected = currentVal === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            onChange(primarySelector.fieldKey, opt.value);
                            if (serviceType === 'LOGISTICS' && opt.value.includes('Reefer')) {
                              onChange('tempControlled', true);
                              onChange('shipmentType', 'REEFER – Temperature Controlled');
                            }
                          }}
                          className={`p-4 rounded-xl text-left border transition-all flex flex-col justify-between space-y-3 ${
                            isSelected
                              ? 'bg-blue-500/10 border-blue-500 text-[var(--text-main)] shadow-sm ring-1 ring-blue-500/30'
                              : 'bg-[var(--bg-main)] border-[var(--border-subtle)] hover:border-blue-500/40 text-[var(--text-main)]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xl p-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)]">
                              {opt.icon}
                            </span>
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                              {opt.badge}
                            </span>
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[var(--text-main)]">{opt.title}</h4>
                            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                          </div>
                          <div className="pt-2 border-t border-[var(--border-subtle)] flex justify-between items-center text-xs font-mono">
                            <span className="text-[var(--text-muted)]">
                              {serviceType === 'LEASING' ? 'Typical Term' : 'Rate'}
                            </span>
                            <span className="text-cyan-700 dark:text-cyan-400 font-bold">{opt.rateLabel}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Optional Expandable Live Depot Stock & Lead-Time Check (Fleet-allocating domains) */}
                  {primarySelector.showLiveStockToggle &&
                    !(serviceType === 'STAFF_TRANSPORT' && form.vehicleCategory === 'Scheduled Shuttle Pass') && (
                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        <button
                          type="button"
                          onClick={() => setShowLiveAvailability((prev) => !prev)}
                          className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-cyan-400 hover:underline"
                        >
                          {showLiveAvailability ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                          {showLiveAvailability
                            ? 'Hide Live Depot Stock & Lead-Time Check'
                            : 'Check Live Depot Availability & Dispatch Lead Time'}
                        </button>
                        {showLiveAvailability && (
                          <div className="mt-4">
                            <AssetAvailabilitySelector
                              serviceType={serviceType}
                              startDate={form.startDate as string}
                              pickupTime={form.pickupTime as string}
                              value={(form.vehicleCategory as string) || ''}
                              onChange={(cat, stockMeta) => {
                                onChange('vehicleCategory', cat);
                                if (stockMeta?.sampleModels) onChange('sampleModels', stockMeta.sampleModels);
                                if (stockMeta?.depotId) onChange('depotId', stockMeta.depotId);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                </div>
                )}

                {!primarySelector && (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 flex items-center gap-4 shadow-sm">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex items-center justify-center text-2xl flex-shrink-0">
                      {card.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-[var(--text-main)]">{card.title}</h3>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                          {card.badge}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{card.desc}</p>
                    </div>
                  </div>
                )}

                {/* Rent-a-Car UAE Driver Age Compliance Advisory */}
                {serviceType === 'RENTAL' && driverAge !== null && driverAge < 25 && (
                  <div
                    className={`rounded-2xl px-4 py-3 text-xs flex items-start gap-2.5 border ${
                      driverAge < 21
                        ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">
                        {driverAge < 21
                          ? `Driver Age Restriction (${driverAge} yrs): Minimum age for UAE vehicle rentals is 21.`
                          : `Young Driver Notice (${driverAge} yrs): 4x4 and premium SUV classes require age 25+ or young-driver excess coverage.`}
                      </p>
                    </div>
                  </div>
                )}

                {/* 2. Domain-Specific Form Sections */}
                {schema.map((section) => (
                  <FormSection
                    key={`${serviceType}-${section.title}`}
                    section={section}
                    form={form}
                    onChange={onChange}
                    serviceType={serviceType}
                  />
                ))}

                {/* 3. Opt-in Logistics Planning Modules (only shown when toggled on by user) */}
                {serviceType === 'LOGISTICS' && !!form.multiStopRequired && (
                  <MultiStopRoutePicker
                    initialOrigin={(form.origin as string) || undefined}
                    initialDestination={(form.destination as string) || undefined}
                    baseFareAed={Number(form.fareSubtotal) || 250}
                    onRouteChange={(result) => {
                      onChange('multiStopDistanceKm', result.totalDistanceKm);
                      onChange('multiStopDurationMins', result.totalDurationMins);
                      onChange('multiStopSalikTollsAed', result.totalSalikTollsAed);
                      onChange('multiStopTotalPallets', result.totalPallets);
                      onChange('multiStopTotalWeightTons', result.totalWeightTons);
                      onChange('multiStopCo2EmissionsKg', result.co2EmissionsKg);
                      if (result.ltlConsolidation.isEligible) {
                        onChange('ltlConsolidationEligible', true);
                        onChange('ltlConsolidationDiscountPercent', result.ltlConsolidation.discountPercent);
                      }
                    }}
                  />
                )}

                {serviceType === 'LOGISTICS' && !!form.recurringFreight && (
                  <RecurringSchedulePicker
                    serviceType={serviceType}
                    singleTripFareAed={Number(form.fareSubtotal) || 250}
                    onScheduleChange={({ config, trips, pricing }) => {
                      onChange('recurringScheduleType', config.scheduleType);
                      onChange('recurringFrequency', config.frequency);
                      onChange('recurringDays', JSON.stringify(config.daysOfWeek));
                      onChange('recurringTotalTrips', trips.length);
                      onChange('recurringDiscountPercent', pricing.discountPercent);
                      onChange('recurringTotalContractAed', pricing.totalWithVatAed);
                    }}
                  />
                )}

                {serviceType === 'LOGISTICS' && !!form.bulkManifestUpload && (
                  <BulkConsignmentUploader
                    onBatchDispatched={(result) => {
                      onChange('bulkManifestNumber', result.masterManifestNumber);
                      onChange('bulkTotalPallets', result.totalPallets);
                      onChange('bulkTotalWeightKg', result.totalWeightKg);
                      onChange('bulkSummaryPricingAed', result.summaryPricingAed);
                    }}
                  />
                )}

                {/* 3b. Cloud-Storage Document Upload Dropzones (Logistics & School Bus) */}
                {serviceType === 'LOGISTICS' && (
                  <BookingDocumentDropzone
                    domain="logistics"
                    title="Shipping & Compliance Documents"
                    subtitle="Attach commercial invoice, packing list, MSDS, or customs permits — encrypted in private cloud storage"
                    slots={logisticsUploadSlots}
                    documents={uploadedDocs}
                    onChange={setUploadedDocs}
                  />
                )}

                {serviceType === 'SCHOOL_BUS' && (
                  <BookingDocumentDropzone
                    domain="school-bus"
                    title="Student Photo & Guardian Verification Documents"
                    subtitle="Upload student photo for RFID boarding card, parent Emirates ID, and any medical action plan"
                    slots={schoolBusUploadSlots}
                    documents={uploadedDocs}
                    onChange={setUploadedDocs}
                  />
                )}

                {/* 4. Domain-Specific Pricing & Billing Allocation */}
                {/* RENT-A-CAR: Corporate (B2B) vs. Personal / Walk-in (B2C) Toggle */}
                {serviceType === 'RENTAL' && (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--text-main)]">
                          Renter Account & Billing Type
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Choose Personal for walk-in / B2C rentals or Corporate to charge a department cost center
                        </p>
                      </div>
                      <div className="inline-flex rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] p-1 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onChange('renterAccountType', 'PERSONAL');
                            onChange('costCenter', '');
                            onChange('projectCode', '');
                            onChange('billingMethod', 'PERSONAL_CARD_AT_COUNTER');
                          }}
                          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
                            isPersonalRental
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          <User className="w-3.5 h-3.5" />
                          Personal / Walk-in (B2C)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChange('renterAccountType', 'CORPORATE');
                            onChange('costCenter', (form.costCenter as string) || 'CC-OPS-3003');
                            onChange('billingMethod', 'CORPORATE_ACCOUNT');
                          }}
                          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
                            !isPersonalRental
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          Corporate Account (B2B)
                        </button>
                      </div>
                    </div>

                    {/* Personal / Walk-in B2C Fare Estimate & Payment Method (Cost Center Hidden) */}
                    {isPersonalRental && personalRentalEst && (
                      <div className="space-y-4 pt-3 border-t border-[var(--border-subtle)]">
                        <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-2 text-xs">
                          <div className="flex justify-between text-[var(--text-muted)]">
                            <span>
                              Vehicle Rental ({rentalDays} {rentalDays === 1 ? 'day' : 'days'})
                            </span>
                            <span className="font-mono font-semibold text-[var(--text-main)]">
                              AED {personalRentalEst.baseFareAed.toFixed(2)}
                            </span>
                          </div>
                          {rentalAddOnsAed > 0 && (
                            <div className="flex justify-between text-[var(--text-muted)]">
                              <span>Protection & Selected Add-ons</span>
                              <span className="font-mono font-semibold text-[var(--text-main)]">
                                AED {rentalAddOnsAed.toFixed(2)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between text-[var(--text-muted)] pt-1.5 border-t border-[var(--border-subtle)]">
                            <span>UAE FTA VAT (5.0%)</span>
                            <span className="font-mono">AED {personalRentalEst.vatAmountAed.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between items-baseline pt-2 border-t border-[var(--border-subtle)]">
                            <span className="text-sm font-bold text-[var(--text-main)]">Estimated Rental Total</span>
                            <span className="text-xl font-extrabold font-mono text-teal-600 dark:text-emerald-400">
                              AED {personalRentalEst.totalFareAed.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                          <div>
                            <label className={labelCls}>
                              Payment Method <span className="text-cyan-500">*</span>
                            </label>
                            <select
                              value={
                                (form.personalPaymentMethod as string) ||
                                'Credit Card at Counter (Security Deposit Required)'
                              }
                              onChange={(e) => {
                                onChange('personalPaymentMethod', e.target.value);
                                onChange('billingMethod', e.target.value);
                              }}
                              className={inputCls}
                            >
                              <option value="Credit Card at Counter (Security Deposit Required)">
                                Credit Card at Counter (Security Deposit Required)
                              </option>
                              <option value="Online Pre-Pay Card (Instant Confirmation)">
                                Online Pre-Pay Card (Instant Confirmation)
                              </option>
                              <option value="Apple Pay / Digital Wallet">Apple Pay / Digital Wallet</option>
                              <option value="Debit Card + Refundable Deposit">Debit Card + Refundable Deposit</option>
                            </select>
                          </div>
                          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-[11px] text-[var(--text-muted)] flex items-start gap-2 mt-1 sm:mt-5">
                            <CreditCard className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                            <span>
                              Primary driver must present a valid physical credit card in their name at handover for the refundable UAE security deposit.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {usesCorporateCostCenter && (
                  <InstantPricingCostCenter
                    serviceType={serviceType}
                    vehicleCategory={(form.vehicleCategory as string) || ''}
                    distanceKm={serviceType === 'RENTAL' ? 0 : Number(form.distanceKm) || 0}
                    salikTollsAed={serviceType === 'RENTAL' ? 0 : Number(form.salikTollsAed) || 0}
                    rentalDays={serviceType === 'RENTAL' ? rentalDays : undefined}
                    addOnsAed={serviceType === 'RENTAL' ? rentalAddOnsAed : 0}
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
                )}

                {/* LEASING: Indicative Corporate Fleet Quote Estimate (NO per-km trip fare!) */}
                {serviceType === 'LEASING' && leasingEst && (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-blue-500" />
                        <span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider">
                          Indicative Corporate Fleet Lease Estimate (RFQ)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                        AED · UAE FTA 5% VAT
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-3">
                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">Est. Per Vehicle / Mo</p>
                        <p className="text-base font-bold font-mono text-[var(--text-main)] mt-1">
                          AED {leasingEst.perVehicle.toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-3">
                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">
                          Monthly Fleet ({leasingEst.qty} {leasingEst.qty === 1 ? 'unit' : 'units'} + VAT)
                        </p>
                        <p className="text-base font-bold font-mono text-teal-600 dark:text-emerald-400 mt-1">
                          AED {leasingEst.monthlyTotal.toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-3">
                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">
                          Est. {leasingEst.months}-Month Contract
                        </p>
                        <p className="text-base font-bold font-mono text-[var(--text-main)] mt-1">
                          AED {leasingEst.contractTotal.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Final monthly rate is confirmed upon credit review, residual value calculation, and exact make/model quotation.
                    </p>
                  </div>
                )}

                {/* SCHOOL_BUS: Parent Billing Plan (NO Corporate Cost Center!) */}
                {serviceType === 'SCHOOL_BUS' && schoolBusEst && (
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider">
                          School Transport Fee & Parent Billing Plan
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full">
                        PARENT ACCOUNT
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                      <div>
                        <label className={labelCls}>
                          Preferred Payment Schedule <span className="text-cyan-500">*</span>
                        </label>
                        <select
                          value={(form.schoolBillingPlan as string) || 'Termly Tuition Invoice'}
                          onChange={(e) => {
                            onChange('schoolBillingPlan', e.target.value);
                            onChange('billingMethod', e.target.value);
                          }}
                          className={inputCls}
                        >
                          <option value="Termly Tuition Invoice">Termly Tuition Invoice (Per Term)</option>
                          <option value="Annual Plan (5% Discount)">Annual Plan (5% Early-Pay Discount)</option>
                          <option value="Monthly Auto-Debit">Monthly Auto-Debit Card</option>
                          <option value="School Portal Direct Billing">School Portal Direct Billing</option>
                        </select>
                      </div>
                      <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">
                            Est. Monthly Fee (Incl. 5% VAT)
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{schoolBusEst.plan}</p>
                        </div>
                        <span className="text-lg font-extrabold font-mono text-teal-600 dark:text-emerald-400">
                          AED {schoolBusEst.totalMonthly.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Omnichannel Alerts (Live-tracking / operational domains only — hidden on LEASING RFQ) */}
                {serviceType !== 'LEASING' && (
                  <OmnichannelNotificationPreferences
                    serviceType={serviceType}
                    vehicleCategory={(form.vehicleCategory as string) || ''}
                    pickupLocation={(form.origin as string) || ''}
                    destinationLocation={(form.destination as string) || ''}
                    totalFareAed={summaryTotal}
                    requestorName={
                      (form.passengerName as string) ||
                      (form.studentName as string) ||
                      (form.requestorName as string) ||
                      'Contact'
                    }
                    phone={(form.phone as string) || (form.contactPhone as string) || ''}
                    email={(form.requestorEmail as string) || ''}
                    onChange={(channels, phone) => {
                      onChange('notificationChannels', JSON.stringify(channels));
                      onChange('contactPhone', phone);
                    }}
                  />
                )}

                {/* 6. Digital KYC, Driving License OCR & Rental e-Sign (RENTAL ONLY!) */}
                {serviceType === 'RENTAL' && (
                  <DigitalKycUaePass
                    requestorName={(form.requestorName as string) || ''}
                    requestorEmail={(form.requestorEmail as string) || ''}
                    onKycVerified={(kyc) => {
                      if (kyc.uaePassVerified) onChange('uaePassVerified', true);
                      if (kyc.emiratesId) onChange('emiratesId', kyc.emiratesId);
                      if (kyc.drivingLicenseNo) onChange('licenseNo', kyc.drivingLicenseNo);
                      if (kyc.licenseExpiry) onChange('licenseExpiry', kyc.licenseExpiry);
                      if (kyc.signatureHash) onChange('signatureHash', kyc.signatureHash);
                      if (kyc.signatureDataUrl) onChange('signatureDataUrl', kyc.signatureDataUrl);
                    }}
                  />
                )}

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
                    <span className="flex-shrink-0">⚠️</span>
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* ── RIGHT COLUMN (100% Domain-Aware Dynamic Booking Summary) ── */}
              <div className="lg:col-span-4 sticky top-20 space-y-4">
                <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 shadow-sm space-y-5">
                  {/* Summary Header */}
                  <div className="border-b border-[var(--border-subtle)] pb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-[var(--text-main)]">
                        {card.title} Summary
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)]">Live booking overview</p>
                    </div>
                    <span className="text-xl">{card.icon}</span>
                  </div>

                  {/* Dynamic Domain-Specific Key Details */}
                  <div className="space-y-2.5 text-xs">
                    {serviceType === 'RENTAL' && (
                      <>
                        <SummaryRow
                          label="Booking Type"
                          value={isPersonalRental ? 'Personal / Walk-in (B2C)' : 'Corporate Account (B2B)'}
                        />
                        <SummaryRow label="Vehicle Class" value={(form.vehicleCategory as string) || 'Not selected'} />
                        <SummaryRow label="Rental Duration" value={`${rentalDays} ${rentalDays === 1 ? 'Day' : 'Days'}`} mono />
                        <SummaryRow label="Pickup Date" value={(form.startDate as string) || 'Select date'} mono />
                        <SummaryRow label="Return Date" value={(form.endDate as string) || 'Select date'} mono />
                        <SummaryRow
                          label="Protection"
                          value={String(form.insurancePackage || 'Basic CDW').split('(')[0].trim()}
                        />
                        {form.origin && <SummaryRow label="Pickup Branch" value={form.origin as string} truncate />}
                      </>
                    )}

                    {serviceType === 'LEASING' && leasingEst && (
                      <>
                        <SummaryRow label="Lease Program" value={(form.leaseType as string) || 'Operating Lease'} truncate />
                        <SummaryRow label="Vehicle Segment" value={(form.vehicleCategory as string) || 'Not selected'} />
                        <SummaryRow label="Fleet Size" value={`${leasingEst.qty} ${leasingEst.qty === 1 ? 'Vehicle' : 'Vehicles'}`} mono />
                        <SummaryRow label="Contract Term" value={(form.leaseDuration as string) || '36 months'} mono />
                        <SummaryRow label="Annual Mileage" value={(form.annualMileage as string) || '30,000 km/yr'} mono />
                        <SummaryRow label="Delivery Emirate" value={(form.deliveryEmirate as string) || 'Dubai'} />
                      </>
                    )}

                    {serviceType === 'STAFF_TRANSPORT' && (
                      <>
                        <SummaryRow label="Service Tier" value={(form.vehicleCategory as string) || 'Scheduled Shuttle Pass'} />
                        <SummaryRow label="Direction" value={String(form.commuteDirection || 'Two-Way').split('(')[0].trim()} />
                        <SummaryRow label="Shift Window" value={(form.shiftType as string) || 'Select shift'} truncate />
                        <SummaryRow label="Working Days" value={(form.workDays as string) || 'Monday–Friday'} />
                        {(form.pickupTime || form.returnTime) && (
                          <SummaryRow
                            label="Schedule Times"
                            value={`${(form.pickupTime as string) || '—'} / ${(form.returnTime as string) || '—'}`}
                            mono
                          />
                        )}
                        {form.origin && <SummaryRow label="Pickup Zone" value={form.origin as string} truncate />}
                        {form.destination && <SummaryRow label="Workplace" value={form.destination as string} truncate />}
                      </>
                    )}

                    {serviceType === 'EXECUTIVE' && (
                      <>
                        <SummaryRow label="Chauffeur Class" value={(form.vehicleCategory as string) || 'Luxury Sedan'} />
                        <SummaryRow label="Trip Type" value={(form.tripType as string) || 'City Transfer'} />
                        <SummaryRow
                          label="Schedule"
                          value={
                            form.startDate
                              ? `${form.startDate as string}${form.pickupTime ? ` · ${form.pickupTime as string}` : ''}`
                              : 'Select date & time'
                          }
                          mono
                        />
                        <SummaryRow
                          label="Capacity"
                          value={`${Number(form.paxCount) || 1} Pax · ${Number(form.luggageCount) || 0} Bags`}
                          mono
                        />
                        {form.flightNo && <SummaryRow label="Flight Tracking" value={form.flightNo as string} mono />}
                        {form.destination && <SummaryRow label="Destination" value={form.destination as string} truncate />}
                      </>
                    )}

                    {serviceType === 'LOGISTICS' && (
                      <>
                        <SummaryRow label="Equipment" value={(form.vehicleCategory as string) || '3-Ton Box Truck'} />
                        <SummaryRow label="Load Mode" value={String(form.shipmentType || 'FTL').split('–')[0].trim()} mono />
                        <SummaryRow
                          label="Cargo Spec"
                          value={`${Number(form.pallets) || 0} Units · ${Number(form.weight) || 0} kg`}
                          mono
                        />
                        <SummaryRow label="Pickup Date" value={(form.startDate as string) || 'Select date'} mono />
                        {form.tempControlled && <SummaryRow label="Cold Chain" value={(form.tempRange as string) || 'Temperature Controlled'} />}
                        {form.isHazmat && <SummaryRow label="Hazmat" value={(form.unNumber as string) || 'ADR / IMDG Declared'} />}
                        {form.destination && <SummaryRow label="Delivery Site" value={form.destination as string} truncate />}
                        {uploadedDocs.length > 0 && (
                          <SummaryRow
                            label="Documents"
                            value={`${uploadedDocs.length} ${uploadedDocs.length === 1 ? 'file' : 'files'} attached`}
                            mono
                          />
                        )}
                      </>
                    )}

                    {serviceType === 'SCHOOL_BUS' && (
                      <>
                        <SummaryRow label="Transport Plan" value={(form.vehicleCategory as string) || 'Two-Way Full Service'} />
                        <SummaryRow label="Student" value={(form.studentName as string) || 'Enter student name'} truncate />
                        {form.studentGrade && <SummaryRow label="Grade" value={form.studentGrade as string} />}
                        <SummaryRow label="Term" value={(form.academicTerm as string) || 'Full Academic Year'} />
                        <SummaryRow label="Emirate" value={(form.emirate as string) || 'Dubai'} />
                        {form.destination && <SummaryRow label="School" value={form.destination as string} truncate />}
                        {uploadedDocs.length > 0 && (
                          <SummaryRow
                            label="Documents"
                            value={`${uploadedDocs.length} ${uploadedDocs.length === 1 ? 'file' : 'files'} attached`}
                            mono
                          />
                        )}
                      </>
                    )}

                    {!isBuiltinService && (
                      <>
                        <SummaryRow label="Category" value={card.title} />
                        {form.vehicleCategory && <SummaryRow label="Service / Vehicle" value={String(form.vehicleCategory)} truncate />}
                        {form.startDate && <SummaryRow label="Service Date" value={String(form.startDate)} mono />}
                        {form.pickupTime && <SummaryRow label="Time" value={String(form.pickupTime)} mono />}
                        {form.origin && <SummaryRow label="Origin" value={String(form.origin)} truncate />}
                        {form.destination && <SummaryRow label="Destination" value={String(form.destination)} truncate />}
                      </>
                    )}
                  </div>

                  {/* Itemized Pricing Breakdown (shown for priced domains) */}
                  {isBuiltinService && (
                  <div className="border-t border-b border-[var(--border-subtle)] py-3 space-y-2 text-xs font-mono">
                    <div className="flex justify-between text-[var(--text-main)]">
                      <span>
                        {serviceType === 'LEASING'
                          ? 'Est. Monthly Net'
                          : serviceType === 'SCHOOL_BUS'
                          ? 'Monthly Fee (Net)'
                          : 'Estimated Subtotal'}
                      </span>
                      <span className="font-bold">AED {summarySubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>

                    {Number(form.salikTollsAed) > 0 && serviceType !== 'LEASING' && serviceType !== 'SCHOOL_BUS' && serviceType !== 'RENTAL' && (
                      <div className="flex justify-between text-[var(--text-muted)]">
                        <span>Salik / Darb Tolls</span>
                        <span className="font-bold">AED {Number(form.salikTollsAed).toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-[var(--text-muted)]">
                      <span>5% UAE VAT</span>
                      <span className="font-bold">AED {summaryVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>

                    <div className="pt-2 flex justify-between items-baseline">
                      <span className="text-sm font-bold text-[var(--text-main)] font-sans">
                        {serviceType === 'LEASING'
                          ? 'Monthly (Incl. VAT)'
                          : serviceType === 'SCHOOL_BUS'
                          ? 'Est. Monthly Total'
                          : 'Total (Incl. VAT)'}
                      </span>
                      <span className="text-2xl font-extrabold text-teal-600 dark:text-cyan-400 font-mono">
                        AED {summaryTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  )}

                  {/* Domain-Appropriate Status / Cost Center Pill */}
                  <div className="flex items-center justify-center">
                    {!isBuiltinService ? (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-800 dark:text-cyan-300 text-xs font-semibold">
                        {card.icon} {card.title} ({card.badge})
                      </span>
                    ) : serviceType === 'SCHOOL_BUS' ? (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                        🛡️ RTA-Compliant Student Transport
                      </span>
                    ) : serviceType === 'LEASING' ? (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                        📋 Corporate Fleet RFQ Proposal
                      </span>
                    ) : isPersonalRental ? (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                        💳 Personal / Walk-in Rental (B2C)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-800 dark:text-cyan-300 text-xs font-mono font-bold">
                        ✓ Corporate Cost Center ({(form.costCenter as string) || 'CC-OPS-3003'})
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-sm transition-colors flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50"
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Processing…
                        </span>
                      ) : (
                        meta?.cta || 'Confirm Booking'
                      )}
                    </button>

                    {!initialType && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="w-full mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
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
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">Booking Submitted!</h2>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Your {meta.title.toLowerCase()} request is now logged and pending processing
            </p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
              <div>
                <p className="text-xs text-cyan-600 dark:text-cyan-300 uppercase tracking-wider mb-1 font-semibold">
                  Booking Reference
                </p>
                <p className="text-3xl font-mono font-bold text-cyan-600 dark:text-cyan-400">{bookingRef}</p>
              </div>
              <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl p-3 text-3xl">
                {meta.icon}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ConfirmationDetail label="Service" value={meta.title} />
              {form.requestorName && <ConfirmationDetail label="Requestor" value={form.requestorName as string} />}
              {form.startDate && (
                <ConfirmationDetail
                  label="Start Date"
                  value={new Date(form.startDate as string).toLocaleDateString('en-AE', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                />
              )}
              {form.vehicleCategory && <ConfirmationDetail label="Selected Plan / Class" value={form.vehicleCategory as string} />}
              {form.leaseType && <ConfirmationDetail label="Lease Program" value={form.leaseType as string} />}
              {form.leaseDuration && <ConfirmationDetail label="Lease Term" value={form.leaseDuration as string} />}
              {form.shiftType && <ConfirmationDetail label="Shift Window" value={form.shiftType as string} />}
              {form.tripType && <ConfirmationDetail label="Trip Type" value={form.tripType as string} />}
              {form.shipmentType && <ConfirmationDetail label="Load Mode" value={form.shipmentType as string} />}
              {form.origin && <ConfirmationDetail label="From" value={form.origin as string} />}
              {form.destination && <ConfirmationDetail label="To" value={form.destination as string} />}
              {form.totalFareAed ? (
                <ConfirmationDetail
                  label={serviceType === 'LEASING' ? 'Estimated Monthly (incl. 5% VAT)' : 'Estimated Total (incl. 5% VAT)'}
                  value={`AED ${Number(form.totalFareAed).toFixed(2)}`}
                />
              ) : null}
              {serviceType === 'RENTAL' && (
                <ConfirmationDetail
                  label="Renter Account"
                  value={isPersonalRental ? 'Personal / Walk-in (B2C)' : 'Corporate Account (B2B)'}
                />
              )}
              {serviceType === 'RENTAL' && isPersonalRental && form.personalPaymentMethod && (
                <ConfirmationDetail label="Payment Method" value={form.personalPaymentMethod as string} />
              )}
              {serviceType !== 'SCHOOL_BUS' && !isPersonalRental && form.costCenter && (
                <ConfirmationDetail label="Cost Center" value={form.costCenter as string} />
              )}
              {serviceType === 'SCHOOL_BUS' && form.schoolBillingPlan && (
                <ConfirmationDetail label="Parent Billing Plan" value={form.schoolBillingPlan as string} />
              )}
              {serviceType === 'RENTAL' && form.uaePassVerified ? (
                <ConfirmationDetail label="Identity Verification" value="🇦🇪 UAE PASS Verified" />
              ) : null}
              {form.studentName && <ConfirmationDetail label="Student" value={form.studentName as string} />}
              {form.companyName && <ConfirmationDetail label="Company" value={form.companyName as string} />}
              {form.cargo && <ConfirmationDetail label="Cargo" value={form.cargo as string} />}
            </div>

            {uploadedDocs.length > 0 && (
              <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-main)]">
                  <Paperclip className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Attached Cloud Documents ({uploadedDocs.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {uploadedDocs.map((doc) => (
                    <a
                      key={doc.key}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 rounded-lg px-3 py-2 text-xs transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--text-main)] truncate">{doc.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{doc.originalName}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {meta.confirmNote && (
              <div className="bg-[var(--bg-main)] border border-amber-500/25 rounded-xl px-4 py-3 text-[var(--text-main)] text-xs leading-relaxed">
                {meta.confirmNote}{' '}
                {serviceType === 'LOGISTICS' && (
                  <a href="/logistics/dispatch" className="underline text-amber-600 dark:text-amber-400">
                    View Dispatch Board →
                  </a>
                )}
              </div>
            )}

            {form.requestorEmail && (
              <div className="bg-cyan-500/10 border border-cyan-500/25 rounded-xl px-4 py-3 text-cyan-800 dark:text-cyan-300 text-xs">
                📧 Confirmation details will be sent to <strong>{form.requestorEmail as string}</strong>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => router.push('/booking-portal')}
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-500 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition-all"
            >
              View All Bookings →
            </button>
            <button
              onClick={resetForm}
              className="flex-1 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] px-6 py-3.5 text-sm font-medium text-[var(--text-main)] transition-all border border-[var(--border-subtle)]"
            >
              + Create Another Booking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-[var(--text-main)]">
      <span className="text-[var(--text-muted)] flex-shrink-0">{label}</span>
      <strong
        className={`text-right font-semibold ${mono ? 'font-mono' : ''} ${
          truncate ? 'truncate max-w-[170px]' : ''
        }`}
        title={truncate ? value : undefined}
      >
        {value}
      </strong>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export — wrapped in Suspense for useSearchParams
// ─────────────────────────────────────────────────────────────────────────────

export default function NewBookingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <NewBookingInner />
    </Suspense>
  );
}
