'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Service type card definitions (Step 1)
// ─────────────────────────────────────────────────────────────────────────────

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
  'w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm ' +
  'placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 ' +
  'transition-all';

const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5';

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
      <div className="flex items-start gap-3 bg-slate-800/30 border border-white/8 rounded-xl px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(field.key, !value)}
          className={`relative mt-0.5 flex-shrink-0 w-10 h-6 rounded-full transition-colors ${
            value ? 'bg-violet-500' : 'bg-slate-700'
          }`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
        <div>
          <p className="text-sm font-medium text-white">{field.label}</p>
          {field.hint && <p className="text-xs text-slate-500 mt-0.5">{field.hint}</p>}
        </div>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className={labelCls}>{field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}</label>
        <select
          value={value as string}
          onChange={e => onChange(field.key, e.target.value)}
          required={field.required}
          className={inputCls}
        >
          <option value="">— Select —</option>
          {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {field.hint && <p className="text-xs text-slate-500 mt-1">{field.hint}</p>}
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
        {field.hint && <p className="text-xs text-slate-500 mt-1">{field.hint}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
        {field.unit && <span className="text-slate-600 ml-1 normal-case font-normal">({field.unit})</span>}
      </label>
      <input
        type={field.type}
        value={value as string}
        onChange={e => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        className={inputCls}
      />
      {field.hint && <p className="text-xs text-slate-500 mt-1">{field.hint}</p>}
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
}: {
  section: SectionDef;
  form: FormData;
  onChange: (k: string, v: string | boolean | number) => void;
}) {
  const visibleFields = section.fields.filter(f => !f.showIf || f.showIf(form));

  if (visibleFields.length === 0) return null;

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
    <div className="bg-slate-900/50 border border-white/8 rounded-2xl overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-3 border-b border-white/8 bg-slate-800/30 flex items-center gap-2">
        <span className="text-base">{section.icon}</span>
        <h3 className="text-sm font-bold text-white tracking-wide">{section.title}</h3>
      </div>
      {/* Fields */}
      <div className="p-5 space-y-4">
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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
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
  const searchParams = useSearchParams();
  const router       = useRouter();

  const initialType = (searchParams.get('type') ?? '') as ServiceType | '';
  const [step,        setStep]        = useState<1 | 2 | 3>(initialType ? 2 : 1);
  const [serviceType, setServiceType] = useState<ServiceType | ''>(initialType);
  const [form,        setForm]        = useState<FormData>(EMPTY_FORM);
  const [bookingRef,  setBookingRef]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (initialType) { setServiceType(initialType as ServiceType); setStep(2); }
  }, [initialType]);

  const onChange = (k: string, v: string | boolean | number) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const card = SERVICE_CARDS.find(c => c.type === serviceType);
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
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-3xl font-bold text-white">New Booking Request</h1>
        <p className="text-slate-400 mt-1">Create a transport booking across any service</p>
      </div>

      {/* ── Progress stepper ── */}
      <div className="flex items-center gap-3">
        {(['Select Service', 'Booking Details', 'Confirmation'] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          return (
            <React.Fragment key={label}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  step > n  ? 'bg-emerald-500 text-white' :
                  step === n ? 'bg-violet-500 text-white' :
                  'bg-slate-700 text-slate-500'
                }`}>
                  {step > n ? '✓' : n}
                </div>
                <span className={`text-xs hidden sm:block font-medium transition-colors ${
                  step >= n ? 'text-white' : 'text-slate-600'
                }`}>{label}</span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-0.5 rounded-full transition-all ${
                  step > n ? 'bg-emerald-500' : 'bg-slate-700'
                }`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Step 1 — Service Type Selection
      ══════════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-white">Select Service Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SERVICE_CARDS.map(opt => (
              <button
                key={opt.type}
                onClick={() => { setServiceType(opt.type as ServiceType); setStep(2); }}
                className={`bg-gradient-to-br ${opt.gradient} rounded-2xl p-6 text-left hover:shadow-xl hover:shadow-black/30 transition-all hover:scale-[1.02] active:scale-100`}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-4xl">{opt.icon}</span>
                  <span className="text-xs font-bold bg-black/25 px-2.5 py-1 rounded-lg text-white/80 tracking-wider">
                    {opt.badge}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mb-1">{opt.title}</h3>
                <p className="text-white/70 text-sm leading-relaxed">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Step 2 — Dynamic Form
      ══════════════════════════════════════════════════════════════ */}
      {step === 2 && card && (
        <div className="space-y-5">
          {/* Selected service banner */}
          <div className={`bg-gradient-to-br ${card.gradient} rounded-2xl p-4 flex items-center gap-3`}>
            <span className="text-3xl">{card.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold">{card.title}</p>
              <p className="text-white/65 text-xs">{card.desc}</p>
            </div>
            {!initialType && (
              <button
                type="button"
                onClick={resetForm}
                className="flex-shrink-0 text-white/60 hover:text-white text-xs border border-white/20 rounded-lg px-3 py-1.5 transition-colors"
              >
                Change
              </button>
            )}
          </div>

          {/* Form sections */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {schema.map(section => (
              <FormSection key={section.title} section={section} form={form} onChange={onChange} />
            ))}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-start gap-2">
                <span className="flex-shrink-0">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-4 pt-2">
              {!initialType && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 rounded-xl bg-slate-700/80 hover:bg-slate-700 px-6 py-3 text-sm font-medium text-slate-300 transition-all border border-white/10"
                >
                  ← Back
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-40"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting…
                  </span>
                ) : (
                  'Submit Booking Request →'
                )}
              </button>
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
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Booking Reference</p>
                <p className="text-3xl font-mono font-bold text-white">{bookingRef}</p>
              </div>
              <div className={`bg-gradient-to-br ${meta.gradient} rounded-xl p-3 text-3xl`}>{meta.icon}</div>
            </div>

            <div className="h-px bg-white/8" />

            {/* Key details */}
            <div className="grid grid-cols-2 gap-4">
              <ConfirmationDetail label="Service" value={meta.title} />
              {form.requestorName && <ConfirmationDetail label="Requestor" value={form.requestorName as string} />}
              {form.startDate && (
                <ConfirmationDetail
                  label="Start Date"
                  value={new Date(form.startDate as string).toLocaleDateString('en-AE', { day:'2-digit', month:'short', year:'numeric' })}
                />
              )}
              {form.vehicleCategory && <ConfirmationDetail label="Vehicle Category" value={form.vehicleCategory as string} />}
              {form.origin && <ConfirmationDetail label="From" value={form.origin as string} />}
              {form.destination && <ConfirmationDetail label="To" value={form.destination as string} />}
              {form.studentName && <ConfirmationDetail label="Student" value={form.studentName as string} />}
              {form.companyName && <ConfirmationDetail label="Company" value={form.companyName as string} />}
              {form.leaseDuration && <ConfirmationDetail label="Lease Duration" value={form.leaseDuration as string} />}
              {form.cargo && <ConfirmationDetail label="Cargo" value={form.cargo as string} />}
            </div>

            {/* Service-specific notes */}
            {meta.confirmNote && (
              <div className="bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-slate-300 text-xs leading-relaxed">
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
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-blue-300 text-xs">
                📧 A confirmation will be sent to <strong>{form.requestorEmail as string}</strong>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-4">
            <button
              onClick={() => router.push('/booking-portal')}
              className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all"
            >
              View All Bookings
            </button>
            <button
              onClick={resetForm}
              className="flex-1 rounded-xl bg-slate-700 hover:bg-slate-600 px-6 py-3 text-sm font-medium text-slate-300 transition-all border border-white/10"
            >
              New Booking
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
