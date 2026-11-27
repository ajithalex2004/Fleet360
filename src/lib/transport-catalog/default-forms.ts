/**
 * Default Transport request forms, one per category.
 *
 * Globally benchmarked schemas aligned with the Booking Portal's New Booking
 * forms (src/app/(app)/booking-portal/new/page.tsx) across Rent-a-Car, Leasing,
 * Staff Transport, Executive Vehicles, Logistics, School Bus, plus Limousine
 * and Recovery.
 *
 * `core` marks the fields a request cannot be routed without; tenants can
 * hide or adjust every other field (tenant_transport_categories).
 * `menu` lists the category's own Customer Portal pages, shown after the
 * common New request / Active requests / History.
 *
 * Browser-safe.
 */

import type { TransportCategory } from '@/lib/customer-portal/catalog';
import type { RequestFieldDef, RequestFieldType, RequestFormDef, RequestSectionDef } from './form-schema';

export interface CategoryDefinition {
  category: TransportCategory;
  title: string;
  description: string;
  /** Vehicle usage recorded on requests, as in the FSM catalogue. */
  vehicleUsage: string;
  menu: string[];
  form: RequestFormDef;
}

type Extra = Omit<RequestFieldDef, 'key' | 'label' | 'type'>;
const f = (key: string, label: string, type: RequestFieldType, extra: Extra = {}): RequestFieldDef => ({ key, label, type, ...extra });
const s = (key: string, title: string, fields: RequestFieldDef[]): RequestSectionDef => ({ key, title, fields });
const req = { required: true } as const;
const half = { half: true } as const;

// Contact block shared by most forms (prefilled from the signed-in account in the portal).
const contact = (nameLabel = 'Full Name', emailLabel = 'Email Address', phone: Extra = half) => [
  f('requestorName', nameLabel, 'text', { ...req, ...half, placeholder: 'Your full name' }),
  f('requestorEmail', emailLabel, 'email', { ...req, ...half, placeholder: 'you@company.com' }),
  f('phone', 'Mobile Number', 'tel', { placeholder: '+971 50 000 0000', ...phone }),
];
const notes = (label: string, placeholder: string) => s('notes', 'Notes', [f('notes', label, 'textarea', { placeholder })]);

// ── Rent-a-Car (Benchmarked vs Hertz, Enterprise, Sixt, UAE RTA) ────────────
const RAC: CategoryDefinition = {
  category: 'RAC', title: 'Rent-a-Car', description: 'Short-term vehicle rental (Personal B2C & Corporate B2B)', vehicleUsage: 'Rental',
  menu: ['Agreements', 'Invoices'],
  form: { sections: [
    s('account', 'Renter Account & Billing', [
      f('renterAccountType', 'Booking Account Type', 'select', { ...half,
        options: ['Personal / Walk-in (B2C)', 'Corporate Account (B2B)'],
        hint: 'Personal hides Cost Center; Corporate enables department chargeback' }),
      f('costCenter', 'Corporate Cost Center', 'text', { ...half, placeholder: 'e.g. CC-OPS-3003',
        showIf: { field: 'renterAccountType', equals: 'Corporate Account (B2B)' } }),
      f('paymentMethod', 'Payment Method', 'select', { ...half,
        options: ['Credit Card at Counter (Security Deposit Required)', 'Online Pre-Pay Card', 'Apple Pay / Digital Wallet', 'Corporate Master Account'] }),
    ]),
    s('requestor', 'Primary Driver & License Compliance', [
      ...contact('Primary Driver Full Name'),
      f('driverDob', 'Driver Date of Birth', 'date', { ...half, hint: 'UAE RTA minimum age is 21 (25+ for 4x4 & premium SUVs)' }),
      f('licenseCountry', 'License Issuing Country', 'select', { ...half,
        options: ['United Arab Emirates', 'Saudi Arabia / GCC', 'United Kingdom', 'United States', 'European Union', 'India', 'Other International'] }),
      f('emiratesId', 'Emirates ID / Passport No.', 'text', { ...half, placeholder: '784-XXXX-XXXXXXX-X' }),
      f('licenseNo', 'Driving License No.', 'text', { ...half, placeholder: 'Valid license number' }),
      f('licenseExpiry', 'License Expiry Date', 'date', half),
      f('idpRequired', 'International Driving Permit (IDP) Held', 'toggle', {
        hint: 'Required by UAE RTA for visitors whose domestic license is not on the approved list',
        showIf: { field: 'licenseCountry', notEquals: 'United Arab Emirates' },
      }),
    ]),
    s('vehicle', 'Vehicle Class, Protection & Extras', [
      f('vehicleCategory', 'Vehicle Category', 'select', { ...req, ...half, core: true,
        options: ['Economy', 'Compact', 'Mid-Size', 'Full-Size', 'SUV', '4x4', 'Van', 'Pickup Truck'] }),
      f('insurancePackage', 'Insurance & Excess Protection', 'select', { ...half,
        options: ['Basic CDW (Standard Excess)', 'Super CDW (Zero Excess)', 'Full Protection (Zero Excess + Glass & Tyres)'] }),
      f('mileagePlan', 'Mileage Allowance', 'select', { ...half,
        options: ['Standard (250 km/day)', 'Extended (400 km/day)', 'Unlimited Mileage'] }),
      f('transmission', 'Transmission', 'select', { ...half, options: ['Automatic', 'Manual', 'No Preference'] }),
      f('fuelType', 'Fuel / Powertrain', 'select', { ...half, options: ['Petrol', 'Hybrid', 'Electric', 'Diesel', 'No Preference'] }),
      f('childSeat', 'Child / Booster Seat', 'select', { ...half,
        options: ['None', 'Infant Seat (0–1 yr)', 'Toddler Seat (1–4 yrs)', 'Booster Seat (4–8 yrs)'] }),
      f('additionalDriver', 'Additional Authorized Driver', 'toggle', { hint: 'Add a second authorised driver (extra fee may apply)' }),
      f('gpsUnit', 'GPS Navigation / In-Car WiFi', 'toggle', { hint: 'Pre-loaded GCC navigation & hotspot' }),
      f('crossBorderPermit', 'GCC Cross-Border NOC (Oman)', 'toggle', { hint: 'Requires advance insurance extension & border NOC' }),
    ]),
    s('period', 'Rental Period & Flight Hold', [
      f('startDate', 'Pickup Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time', 'time', half),
      f('endDate', 'Return Date', 'date', half),
      f('returnTime', 'Return Time', 'time', half),
      f('flightNo', 'Arrival Flight Number (Airport Pickups)', 'text', { ...half, placeholder: 'e.g. EK002 — holds vehicle on delay' }),
    ]),
    s('location', 'Pickup & Return Location', [
      f('origin', 'Pickup Branch / Location', 'text', { ...req, core: true, placeholder: 'Branch, airport terminal, hotel, or address' }),
      f('sameReturnLoc', 'Return to same location', 'toggle', { hint: 'Return the vehicle to the pickup point' }),
      f('destination', 'Return Branch / Location', 'text', { placeholder: 'Different return branch or address', showIf: { field: 'sameReturnLoc', truthy: false } }),
    ]),
    notes('Special Requests', 'Doorstep delivery instructions, corporate loyalty code, preferred colour…'),
  ] },
};

// ── Vehicle Leasing (Benchmarked vs Ayvens, Arval, Element Fleet) ───────────
const LEASING: CategoryDefinition = {
  category: 'LEASING', title: 'Leasing', description: 'Long-term corporate & SME fleet lease proposals', vehicleUsage: 'Leasing',
  menu: ['Contracts', 'Invoices', 'Documents'],
  form: { sections: [
    s('company', 'Company & Procurement Contact', [
      f('customerType', 'Account Type', 'select', { ...half,
        options: ['Corporate / Enterprise', 'SME / Commercial', 'Government / Semi-Gov', 'Individual Long-Term'] }),
      f('companyName', 'Company / Organisation', 'text', { ...req, ...half, placeholder: 'Legal company name',
        showIf: { field: 'customerType', notEquals: 'Individual Long-Term' } }),
      f('requestorName', 'Contact Person', 'text', { ...req, ...half, placeholder: 'Your full name' }),
      f('jobTitle', 'Job Title / Role', 'text', { ...half, placeholder: 'Fleet Manager, Procurement, HR…',
        showIf: { field: 'customerType', notEquals: 'Individual Long-Term' } }),
      f('requestorEmail', 'Email Address', 'email', { ...req, ...half, placeholder: 'contact@company.com' }),
      f('phone', 'Direct Phone', 'tel', { ...half, placeholder: '+971 4 000 0000' }),
      f('tradeNo', 'Trade License No.', 'text', { ...half, placeholder: 'CN-XXXXXXX',
        showIf: { field: 'customerType', notEquals: 'Individual Long-Term' } }),
      f('vatNo', 'UAE TRN / VAT No.', 'text', { ...half, placeholder: '100XXXXXXXXX003',
        showIf: { field: 'customerType', notEquals: 'Individual Long-Term' } }),
    ]),
    s('fleet', 'Fleet Composition & Contract Terms', [
      f('leaseType', 'Lease Program Structure', 'select', { ...half,
        options: ['Operating Lease (Full-Service)', 'Finance Lease / Lease-to-Own', 'Flexi-Lease (3–11 Months)', 'EV / Green Fleet Lease'] }),
      f('vehicleCategory', 'Primary Vehicle Segment', 'select', { ...req, ...half, core: true,
        options: ['Compact Sedan', 'Mid-Size Sedan', 'SUV', 'Van (7-seater)', 'Mini-Bus', 'Bus', 'Pickup Truck', 'Mixed Fleet'] }),
      f('quantity', 'Number of Vehicles', 'number', { ...req, ...half, core: true, placeholder: '1', unit: 'vehicles' }),
      f('leaseDuration', 'Contract Term', 'select', { ...req, ...half, core: true,
        options: ['6 months', '12 months', '18 months', '24 months', '36 months', '48 months', '60 months'] }),
      f('annualMileage', 'Annual Mileage Cap', 'select', { ...half,
        options: ['20,000 km/yr', '30,000 km/yr', '40,000 km/yr', '60,000 km/yr', 'Unlimited'] }),
      f('startDate', 'Target Fleet Delivery Date', 'date', { ...req, ...half, core: true }),
      f('deliveryEmirate', 'Delivery Emirate', 'select', { ...half,
        options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Multi-Emirate'] }),
      f('monthlyBudget', 'Target Budget / Vehicle', 'number', { ...half, placeholder: '2500', unit: 'AED/mo' }),
    ]),
    s('preferences', 'Vehicle & Powertrain Specifications', [
      f('preferredBrand', 'Preferred Make / Model(s)', 'text', { ...half, placeholder: 'Toyota Corolla, Nissan X-Trail, Tesla Model Y…' }),
      f('fuelType', 'Powertrain Preference', 'select', { ...half, options: ['Petrol (ICE)', 'Hybrid (HEV)', 'Plug-in Hybrid (PHEV)', 'Fully Electric (BEV)', 'Diesel', 'No Preference'] }),
      f('transmission', 'Transmission', 'select', { ...half, options: ['Automatic', 'Manual', 'No Preference'] }),
      f('color', 'Exterior Colour', 'text', { ...half, placeholder: 'White, Silver, Fleet Branded…' }),
    ]),
    s('inclusions', 'Full-Service Lease Inclusions', [
      f('insuranceIncluded', 'Comprehensive Fleet Insurance & Accident Management', 'toggle', { hint: 'Third-party, comprehensive cover & claims handling included' }),
      f('maintenanceIncluded', 'Scheduled Maintenance, Servicing & Repair (SMR)', 'toggle', { hint: 'Scheduled services, repairs & RTA registration renewal' }),
      f('tyresIncluded', 'Tyre Replacement & Alignment', 'toggle', { hint: 'Fair wear-and-tear tyre replacement included' }),
      f('replacementVehicleIncluded', '24/7 Relief / Replacement Vehicle', 'toggle', { hint: 'Guaranteed courtesy vehicle during service or accident downtime' }),
      f('roadsideAssistance', '24/7 Roadside Assistance & Recovery', 'toggle', { hint: 'UAE-wide breakdown recovery and dispatch' }),
      f('salikIncluded', 'Salik / Darb Toll & Traffic Fine Administration', 'toggle', { hint: 'Consolidated monthly billing for tolls and traffic fines' }),
      f('telematicsIncluded', 'GPS Telematics & ESG Fleet Portal Access', 'toggle', { hint: 'Live fleet utilization, safety scoring & CO2 reporting' }),
    ]),
    notes('Upfitting, Branding & RFP Notes', 'Commercial shelving, fleet livery, phased delivery schedule, payment terms…'),
  ] },
};

// ── Limousine ───────────────────────────────────────────────────────────────
const LIMOUSINE: CategoryDefinition = {
  category: 'LIMOUSINE', title: 'Limousine', description: 'Chauffeured limousine for occasions and transfers', vehicleUsage: 'Chauffeur Service',
  menu: [],
  form: { sections: [
    s('requestor', 'Booking Contact', contact('Booking Contact Name')),
    s('booking', 'Vehicle & Booking', [
      f('vehicleCategory', 'Limousine Type', 'select', { ...req, ...half, core: true,
        options: ['Standard Limousine', 'Stretch Limousine', 'Luxury Sedan', 'Luxury SUV', 'VIP Sprinter Van'] }),
      f('occasion', 'Occasion', 'select', { ...half,
        options: ['Airport Transfer', 'Wedding', 'Corporate Event', 'City Tour', 'Party / Celebration', 'Other'] }),
      f('paxCount', 'No. of Passengers', 'number', { ...req, ...half, placeholder: '2', unit: 'pax' }),
      f('bookingType', 'Booking Type', 'select', { ...req, ...half, core: true, options: ['Point to Point', 'Hourly', 'Full Day'] }),
      f('hours', 'Hours Required', 'number', { ...half, placeholder: '3', unit: 'hours', showIf: { field: 'bookingType', equals: 'Hourly' } }),
    ]),
    s('journey', 'Journey', [
      f('origin', 'Pickup Location', 'text', { ...req, core: true, placeholder: 'Hotel, residence, terminal' }),
      f('destination', 'Drop-off Location', 'text', { placeholder: 'Leave blank for hourly / full-day bookings' }),
      f('startDate', 'Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time', 'time', { ...req, ...half, core: true }),
      f('flightNo', 'Flight Number', 'text', { ...half, placeholder: 'EK001', showIf: { field: 'occasion', equals: 'Airport Transfer' } }),
    ]),
    s('extras', 'Extras', [
      f('decorations', 'Decorations', 'toggle', { hint: 'Ribbons and flowers for weddings and celebrations' }),
      f('refreshments', 'Refreshments on board', 'toggle'),
      f('chauffeurDress', 'Chauffeur Dress Code', 'select', { ...half, options: ['Standard Uniform', 'Formal Suit', 'Traditional'] }),
      f('notes', 'Special Instructions', 'textarea', { placeholder: 'Meet & greet sign, route, protocol notes…' }),
    ]),
  ] },
};

// ── Staff Transport (Benchmarked vs MoveInSync, Zeelo, Liftango) ────────────
const STAFF_TRANSPORT: CategoryDefinition = {
  category: 'STAFF_TRANSPORT', title: 'Staff Transport', description: 'Employee commuter shuttle passes & dedicated shift buses', vehicleUsage: 'Staff Transport',
  menu: ['Routes & schedules'],
  form: { sections: [
    s('service', 'Shuttle Service Tier', [
      f('vehicleCategory', 'Service Mode / Bus Tier', 'select', { ...half,
        options: ['Scheduled Shuttle Pass', '14-Seat Minibus', '30-Seat Coaster', '50-Seat Luxury Coach'],
        hint: 'Select individual commuter pass or dedicated team shift bus' }),
      f('passType', 'Booking Cadence', 'select', { ...half,
        options: ['Regular Standing Pass', 'Hybrid / Flexible Days', 'Temporary / Ad-Hoc Shift'] }),
      f('paxCount', 'Number of Staff / Seats', 'number', { ...half, placeholder: '10', unit: 'staff',
        showIf: { field: 'vehicleCategory', notEquals: 'Scheduled Shuttle Pass' } }),
    ]),
    s('employee', 'Employee Profile & Safety Contact', [
      ...contact('Employee Name', 'Work Email'),
      f('employeeId', 'Employee ID / Badge No.', 'text', { ...half, placeholder: 'EMP-XXXXX' }),
      f('department', 'Department', 'text', { ...half, placeholder: 'Operations, IT, Finance, HR…' }),
      f('emergencyContact', 'Emergency Contact (Name & Phone)', 'text', { ...half, placeholder: 'Next-of-kin name & +971 5X…' }),
    ]),
    s('route', 'Commute Route & Stop Mapping', [
      f('commuteDirection', 'Trip Direction', 'select', { ...half,
        options: ['Two-Way (Home ↔ Workplace)', 'Inbound Only (Home → Workplace)', 'Outbound Only (Workplace → Home)', 'Inter-Site Shuttle (Office A ↔ Office B)'] }),
      f('preferredStopLandmark', 'Nearest Bus Stop / Landmark / Gate', 'text', { ...half, placeholder: 'e.g. Al Nahda Metro Exit 2, Gate 3' }),
      f('origin', 'Home Pickup Area / Stop', 'text', { ...req, core: true, placeholder: 'Residential community, street, or shuttle stop' }),
      f('destination', 'Office / Workplace Facility', 'text', { ...req, core: true, placeholder: 'Office tower, warehouse hub, or site' }),
    ]),
    s('schedule', 'Shift & Weekly Schedule', [
      f('shiftType', 'Shift Window', 'select', { ...half,
        options: ['Morning (06:00–14:00)', 'Afternoon (14:00–22:00)', 'Night (22:00–06:00)', 'Standard (09:00–18:00)', 'Split Shift'] }),
      f('workDays', 'Working Days', 'select', { ...req, ...half,
        options: ['Monday–Friday', 'Sunday–Thursday', 'Monday–Saturday', 'Sunday–Saturday', 'Custom Hybrid Days'] }),
      f('pickupTime', 'Inbound Pickup Time', 'time', { ...req, ...half, core: true }),
      f('returnTime', 'Outbound Return Time', 'time', half),
      f('startDate', 'Service Start Date', 'date', { ...req, ...half, core: true }),
      f('endDate', 'Service End Date (Optional)', 'date', { ...half, hint: 'Leave blank for ongoing permanent pass' }),
    ]),
    s('additional', 'Accessibility & Boarding Requirements', [
      f('accessibilityNeeds', 'Accessibility / Special Assistance', 'select', { ...half,
        options: ['None', 'Wheelchair Accessible', 'Front-Seat Priority', 'Hearing / Visual Assistance', 'Other'] }),
      f('genderPreference', 'Shuttle / Driver Preference', 'select', { ...half,
        options: ['No Preference', 'Female-Only Shuttle / Section', 'Male Driver', 'Female Driver'] }),
      f('notes', 'Gate Access & Pickup Instructions', 'textarea', { placeholder: 'Exact residential gate, security pass, or equipment instructions…' }),
    ]),
  ] },
};

// ── Executive Vehicles (Benchmarked vs Blacklane, Carey, Wheely) ────────────
const EXECUTIVE: CategoryDefinition = {
  category: 'EXECUTIVE', title: 'Executive Vehicles', description: 'Chauffeur-driven luxury vehicles for VIP transfers & roadshows', vehicleUsage: 'Executive Service',
  menu: [],
  form: { sections: [
    s('requestor', 'Booker (EA) & VIP Passenger Details', [
      f('bookingFor', 'Booking For', 'select', { ...half,
        options: ['Myself', 'Executive / Colleague', 'VIP Client / External Guest'] }),
      f('vipLevel', 'VIP / Protocol Tier', 'select', { ...half,
        options: ['C-Suite / Board', 'Senior Management', 'Government Official', 'Client / Guest', 'Standard Executive'] }),
      ...contact('Booker / EA Full Name', 'Booker Email'),
      f('department', 'Department / Cost Center', 'text', { ...half, placeholder: 'C-Suite, Exec Office…' }),
      f('passengerName', 'Lead Passenger Full Name', 'text', { ...half, placeholder: 'Traveller name for manifest & signboard',
        showIf: { field: 'bookingFor', notEquals: 'Myself' } }),
      f('passengerPhone', 'Passenger Mobile (Chauffeur Tracking)', 'tel', { ...half, placeholder: '+971 50 000 0000',
        showIf: { field: 'bookingFor', notEquals: 'Myself' } }),
      f('paxCount', 'No. of Passengers', 'number', { ...half, placeholder: '1', unit: 'pax' }),
      f('luggageCount', 'Checked Luggage Pieces', 'number', { ...half, placeholder: '2', unit: 'bags' }),
    ]),
    s('vehicle', 'Chauffeur Class & Trip Type', [
      f('vehicleCategory', 'Vehicle Class', 'select', { ...req, ...half, core: true,
        options: ['Business Sedan', 'Luxury Sedan', 'Luxury SUV', 'Executive Van (MPV)', 'Stretch Limousine', 'SUV Convoy'] }),
      f('tripType', 'Trip Type', 'select', { ...req, ...half,
        options: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)', 'City Transfer', 'Event / Function', 'Road Show', 'Full Day', 'Multi-Day'] }),
      f('charterHours', 'Hourly Charter Duration', 'select', { ...half,
        options: ['3 Hours', '5 Hours', '8 Hours (Full Day)', '10 Hours', '12 Hours'],
        showIf: { field: 'tripType', in: ['Event / Function', 'Road Show', 'Full Day', 'Multi-Day'] } }),
    ]),
    s('outbound', 'Journey Itinerary & Flight Tracking', [
      f('origin', 'Pickup Location', 'text', { ...req, core: true, placeholder: 'Hotel, office, terminal, gate' }),
      f('destination', 'Drop-off Location', 'text', { ...req, core: true, placeholder: 'Destination address or terminal' }),
      f('startDate', 'Pickup Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time', 'time', { ...req, ...half, core: true }),
      f('flightNo', 'Flight Number', 'text', { ...half, placeholder: 'e.g. EK202 — enables live delay tracking',
        showIf: { field: 'tripType', in: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)'] } }),
      f('terminal', 'Airport Terminal', 'select', { ...half,
        options: ['Terminal 1 (DXB)', 'Terminal 2 (DXB)', 'Terminal 3 (DXB)', 'Al Maktoum (DWC)', 'Zayed AUH Terminal A', 'Sharjah (SHJ)', 'Private Jet / FBO Terminal'],
        showIf: { field: 'tripType', in: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)'] } }),
    ]),
    s('return', 'Return Journey', [
      f('returnRequired', 'Add Return Transfer', 'toggle', { hint: 'Schedule a paired return journey' }),
      f('endDate', 'Return Date', 'date', { ...half, showIf: { field: 'returnRequired', truthy: true } }),
      f('returnTime', 'Return Time', 'time', { ...half, showIf: { field: 'returnRequired', truthy: true } }),
      f('returnFrom', 'Return Pickup Address', 'text', { placeholder: 'Leave blank if returning from drop-off', showIf: { field: 'returnRequired', truthy: true } }),
    ]),
    s('extras', 'Chauffeur Protocol & Meet & Greet', [
      f('meetAndGreet', 'Arrivals Hall Meet & Greet with Name Board', 'toggle', { hint: 'Chauffeur waits inside arrivals hall with guest signboard' }),
      f('signboardName', 'Greeting Signboard Text', 'text', { ...half, placeholder: 'e.g. Mr. Al-Mansoori', showIf: { field: 'meetAndGreet', truthy: true } }),
      f('chauffeurLanguage', 'Chauffeur Language Preference', 'select', { ...half, options: ['English', 'Arabic & English', 'No Preference'] }),
      f('extras', 'In-Vehicle Preferences', 'select', { ...half,
        options: ['Standard (Mineral Water & WiFi)', 'Cold Towels & Refreshments', 'Newspapers / Business Press', 'Flowers / VIP Welcome Pack', 'Child / Booster Seat', 'Quiet Ride Requested'] }),
      f('notes', 'Chauffeur & Protocol Instructions', 'textarea', { placeholder: 'VIP gate entry, dress code, multi-stop roadshow schedule, protocol notes…' }),
    ]),
  ] },
};

// ── Logistics (Benchmarked vs Freightos, Flexport, DHL, Uber Freight) ───────
const LOGISTICS: CategoryDefinition = {
  category: 'LOGISTICS', title: 'Logistics', description: 'B2B freight dispatch with FTL/LTL, cold-chain, hazmat & documents', vehicleUsage: 'Logistics',
  menu: ['Shipments', 'Proof of delivery'],
  form: { sections: [
    s('customer', 'Shipper, Consignee & Commercial Reference', [
      f('companyName', 'Shipper Company Name', 'text', { ...req, ...half, placeholder: 'Sending company / shipper' }),
      f('requestorName', 'Shipper Contact Person', 'text', { ...req, ...half, placeholder: 'Your full name' }),
      f('requestorEmail', 'Shipper Email', 'email', { ...req, ...half, placeholder: 'logistics@company.com' }),
      f('phone', 'Shipper Phone / Dock Tel', 'tel', { ...half, placeholder: '+971 50 000 0000' }),
      f('consigneeCompany', 'Consignee / Receiver Company', 'text', { ...half, placeholder: 'Receiving company / store' }),
      f('consigneeContact', 'Consignee Contact & Phone', 'text', { ...half, placeholder: 'Receiver name & +971 5X…' }),
      f('poReference', 'PO / Manifest / Shipment Ref', 'text', { ...half, placeholder: 'e.g. PO-2026-8841 or MAN-DXB-09' }),
      f('incoterms', 'Incoterms', 'select', { ...half,
        options: ['Domestic UAE (N/A)', 'EXW – Ex Works', 'FOB – Free On Board', 'CIF – Cost, Insurance & Freight', 'DAP – Delivered At Place', 'DDP – Delivered Duty Paid'] }),
    ]),
    s('classification', 'Shipment Mode & Commercial Fleet', [
      f('shipmentType', 'Shipment Load Mode', 'select', { ...req, ...half, core: true,
        options: ['FTL – Full Truck Load', 'LTL – Less than Truck Load', 'FCL – Full Container Load', 'LCL – Less than Container Load',
          'REEFER – Temperature Controlled', 'SPECIAL – Oversized / Project Cargo'],
        hint: 'The load type that best matches your shipment' }),
      f('vehicleCategory', 'Commercial Equipment / Truck', 'select', { ...half,
        options: ['Any Available', '1-Ton Courier Van', '3-Ton Box Truck', '3-Ton Reefer (Cold-Chain)', '7-Ton Curtain Sider', '40ft Flatbed Trailer'] }),
    ]),
    s('route', 'Origin, Destination & Dock Schedule', [
      f('originFacilityType', 'Origin Facility Type', 'select', { ...half,
        options: ['Commercial Warehouse (With Dock)', 'Port / Free Zone Terminal', 'Retail Store / Mall Dock', 'Construction / Open Site (No Dock)'] }),
      f('destFacilityType', 'Destination Facility Type', 'select', { ...half,
        options: ['Commercial Warehouse (With Dock)', 'Port / Free Zone Terminal', 'Retail Store / Mall Dock', 'Construction / Open Site (No Dock)'] }),
      f('origin', 'Origin Warehouse / Collection Address', 'text', { ...req, core: true, placeholder: 'Warehouse, JAFZA gate, or collection point' }),
      f('destination', 'Consignee Delivery Facility Address', 'text', { ...req, core: true, placeholder: 'Final receiving warehouse or dock address' }),
      f('startDate', 'Cargo Ready / Pickup Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Dock Time', 'time', half),
      f('deliveryDate', 'Requested Delivery Date', 'date', half),
      f('deliveryTime', 'Delivery Window', 'select', { ...half,
        options: ['Anytime', '06:00–10:00', '10:00–14:00', '14:00–18:00', '18:00–22:00', 'Dock Appointment Required'] }),
    ]),
    s('cargo', 'Cargo, Packaging & Cold-Chain Specs', [
      f('cargoType', 'Commodity Category', 'select', { ...req, ...half,
        options: ['General Goods', 'Fragile / Breakable', 'Perishable / Cold Chain', 'Pharmaceuticals (GDP)', 'Hazardous Materials', 'Heavy Machinery',
          'Electronics', 'Automotive Parts', 'Retail / E-Commerce', 'Furniture', 'Documents / Parcels'] }),
      f('packagingType', 'Packaging Type', 'select', { ...half,
        options: ['Euro Pallets (120×80cm)', 'ISO Pallets (120×100cm)', 'Cartons / Boxes', 'Wooden Crates', 'Drums / IBCs', '20ft / 40ft Container', 'Loose / Bulk'] }),
      f('cargo', 'Commodity Description', 'text', { ...req, core: true, placeholder: 'Clear description of goods for BOL & customs' }),
      f('pallets', 'Pieces / Pallet Count', 'number', { ...half, placeholder: '8', unit: 'units' }),
      f('weight', 'Gross Weight', 'number', { ...half, placeholder: '1200', unit: 'kg' }),
      f('cbm', 'Volume (CBM)', 'number', { ...half, placeholder: '6.5', unit: 'm³' }),
      f('dimensions', 'Dimensions (L×W×H)', 'text', { ...half, placeholder: '120 × 80 × 140 cm' }),
      f('cargoValueAed', 'Declared Cargo Value', 'number', { ...half, placeholder: '50000', unit: 'AED' }),
      f('stackable', 'Cargo is Stackable', 'toggle', { hint: 'Uncheck if pallets/crates cannot be double-stacked in trailer' }),
      f('tempControlled', 'Temperature Controlled (Reefer / Cold Chain)', 'toggle', { hint: 'Cargo needs active refrigeration or controlled temperature' }),
      f('tempRange', 'Target Temperature Band', 'text', { ...half, placeholder: '+2°C to +8°C or -18°C Frozen', showIf: { field: 'tempControlled', truthy: true } }),
      f('tempLoggerRequired', 'Continuous Temperature Data Logger (GDP Audit)', 'toggle', {
        hint: 'Attach calibrated temperature log to delivery certificate',
        showIf: { field: 'tempControlled', truthy: true },
      }),
    ]),
    s('hazmat', 'Hazardous Materials (ADR / IMDG)', [
      f('isHazmat', 'Contains Dangerous Goods (Hazmat)', 'toggle', { hint: 'Classified as hazardous under ADR / IMDG / UAE Civil Defence' }),
      f('unNumber', 'UN Number', 'text', { ...half, placeholder: 'e.g. UN1950', showIf: { field: 'isHazmat', truthy: true } }),
      f('adrClass', 'ADR / IMDG Class', 'select', { ...half, showIf: { field: 'isHazmat', truthy: true },
        options: ['Class 1 – Explosives', 'Class 2 – Gases', 'Class 3 – Flammable Liquids', 'Class 4 – Flammable Solids',
          'Class 5 – Oxidizing Substances', 'Class 6 – Toxic & Infectious', 'Class 7 – Radioactive', 'Class 8 – Corrosives',
          'Class 9 – Misc. Dangerous Goods'] }),
      f('packingGroup', 'Packing Group', 'select', { ...half, showIf: { field: 'isHazmat', truthy: true },
        options: ['PG I – Great Danger', 'PG II – Medium Danger', 'PG III – Minor Danger', 'N/A'] }),
      f('hazmatDescription', 'Proper Shipping Name', 'text', { placeholder: 'e.g. Aerosols, flammable', showIf: { field: 'isHazmat', truthy: true } }),
      f('msdsAvailable', 'MSDS / SDS Document Ready for Handover', 'toggle', { showIf: { field: 'isHazmat', truthy: true } }),
    ]),
    s('service', 'Accessorials & Customs Options', [
      f('liftgateRequired', 'Tail-Lift / Liftgate Truck Required', 'toggle', { hint: 'Needed when origin or destination has no loading dock' }),
      f('driverAssist', 'Driver Loading / Unloading Assistance', 'toggle', { hint: 'Helper or pallet-jack assist at dock' }),
      f('urgentDelivery', 'Urgent / Dedicated Priority Transit', 'toggle', { hint: 'Direct non-stop point-to-point dispatch' }),
      f('podRequired', 'Electronic Proof of Delivery (e-POD) Required', 'toggle', { hint: 'Signed delivery receipt required' }),
      f('insuranceReq', 'All-Risk Transit Cargo Insurance', 'toggle'),
      f('customsClearance', 'Cross-Border / Free-Zone Customs Brokerage', 'toggle'),
      f('hsCode', 'HS Code (Harmonized System)', 'text', { ...half, placeholder: 'e.g. 8471.30', hint: 'Commodity code for customs clearance',
        showIf: { field: 'customsClearance', truthy: true } }),
      f('hsDescription', 'HS Customs Description', 'text', { ...half, placeholder: 'e.g. Portable automatic data processing machines',
        showIf: { field: 'customsClearance', truthy: true } }),
    ]),
    notes('Dock Restrictions & Special Handling Notes', 'Gate pass pre-approval, fragile handling, forklift availability, BOL instructions…'),
  ] },
};

// ── School Bus (Benchmarked vs STS, Emirates Transport, Salama, Zum) ────────
const SCHOOL_BUS: CategoryDefinition = {
  category: 'SCHOOL_BUS', title: 'School Bus', description: 'RTA-compliant student transport enrollment & parent tracking', vehicleUsage: 'School Transport',
  menu: ['Students'],
  form: { sections: [
    s('plan', 'School Transport Service Plan', [
      f('vehicleCategory', 'Transport Plan', 'select', { ...req, ...half, core: true,
        options: ['Two-Way Full Service', 'Morning Pickup Only', 'Afternoon Drop-off Only', 'After-School Activity Bus'] }),
      f('schoolBillingPlan', 'Parent Billing Schedule', 'select', { ...half,
        options: ['Termly Tuition Invoice', 'Annual Plan (5% Discount)', 'Monthly Auto-Debit', 'School Portal Direct Billing'] }),
    ]),
    s('guardian', 'Parent / Guardian Details', [
      ...contact('Parent / Guardian Name', 'Parent Email', { ...req, ...half }),
      f('relationship', 'Relationship to Student', 'select', { ...req, ...half, options: ['Father', 'Mother', 'Legal Guardian', 'Other'] }),
      f('parentEmiratesId', 'Parent Emirates ID No.', 'text', { ...half, placeholder: '784-XXXX-XXXXXXX-X' }),
      f('alternatePhone', 'Secondary Parent Mobile', 'tel', { ...half, placeholder: '+971 55 000 0000' }),
    ]),
    s('student', 'Student Profile', [
      f('studentName', 'Student Full Legal Name', 'text', { ...req, ...half, core: true, placeholder: 'As per school record / Emirates ID' }),
      f('studentId', 'School Admission / Student ID', 'text', { ...half, placeholder: 'e.g. STU-2026-1042' }),
      f('studentGrade', 'Grade / Year & Section', 'text', { ...half, placeholder: 'Grade 5-B, Year 7, FS2…' }),
      f('studentDob', 'Student Date of Birth', 'date', half),
      f('studentGender', 'Student Gender', 'select', { ...half, options: ['Male', 'Female'] }),
    ]),
    s('school', 'School & Enrollment Term', [
      f('destination', 'School Name', 'text', { ...req, ...half, core: true, placeholder: 'Full school name' }),
      f('schoolArea', 'School Campus / Area', 'text', { ...half, placeholder: 'Al Barsha, Jumeirah, Mirdif…' }),
      f('curriculum', 'Curriculum', 'select', { ...half,
        options: ['UAE National', 'British (KHDA / ADEK)', 'American', 'IB (International Baccalaureate)', 'Indian CBSE', 'Indian ICSE', 'Other'] }),
      f('academicTerm', 'Enrollment Term', 'select', { ...half,
        options: ['Full Academic Year', 'Term 1 (Autumn)', 'Term 2 (Winter)', 'Term 3 (Spring)'] }),
    ]),
    s('route', 'Home Residence & Route Mapping', [
      f('emirate', 'Emirate', 'select', { ...half,
        options: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'] }),
      f('makaniNumber', 'Makani Number / Nearest Landmark', 'text', { ...half, placeholder: '10-digit Dubai Makani or gate landmark' }),
      f('origin', 'Home Pickup Address (Community / Building / Villa)', 'text', { ...req, core: true, placeholder: 'Community, street, building or villa number' }),
      f('pickupTime', 'Morning Readiness Window', 'time', { ...req, ...half, hint: 'Approximate preferred time' }),
      f('returnTime', 'School Dismissal Time', 'time', half),
      f('startDate', 'Transport Start Date', 'date', { ...req, ...half, core: true }),
      f('endDate', 'Expected End Date (Optional)', 'date', { ...half, hint: 'Leave blank for full academic year' }),
    ]),
    s('emergency', 'Authorized Drop-Off Receiver & Emergency Contact', [
      f('authorizedReceiverName', 'Authorized Drop-Off Receiver Name', 'text', { ...half, placeholder: 'Adult authorized to meet student at bus stop' }),
      f('authorizedReceiverRelation', 'Receiver Authorization Type', 'select', { ...half,
        options: ['Parent', 'Nanny / Caregiver', 'Grandparent', 'Older Sibling (14+)', 'Self-Disembark Authorized (Grade 6+ Only)'] }),
      f('emergencyContact', 'Emergency Backup Contact Name', 'text', { ...half, placeholder: 'Alternate contact if parents are unreachable' }),
      f('emergencyPhone', 'Emergency Backup Mobile', 'tel', { ...half, placeholder: '+971 50 000 0000' }),
    ]),
    s('medical', 'Medical, Special Needs & RTA Safety Consent', [
      f('medicalConditions', 'Medical Conditions / Allergies', 'textarea', {
        placeholder: 'Asthma, nut allergy, diabetes — anything the bus attendant should know',
        hint: 'Kept confidential and shared only with assigned driver & attendant' }),
      f('specialNeeds', 'Mobility / Supervision Needs', 'select', { ...half,
        options: ['None', 'Wheelchair Lift Bus', 'Extra Bus Attendant Supervision', 'Vision Impaired', 'Hearing Impaired', 'Behavioural Support', 'Other'] }),
      f('epiPenOnBoard', 'Student Carries EpiPen / Emergency Medication', 'toggle', { hint: 'Driver and bus attendant will be briefed before first boarding' }),
      f('busSafetyCodeAccepted', 'I accept the RTA School Bus Safety & Student Behaviour Code', 'toggle', {
        required: true,
        hint: 'Mandatory declaration: student wears seatbelt at all times; guardian meets KG–Grade 5 students at stop 5 mins before ETA',
      }),
    ]),
    notes('Community Gate Pass / Driver Notes', 'Gate code, drop point, sibling on same bus, holiday schedule…'),
  ] },
};

// ── Recovery ────────────────────────────────────────────────────────────────
const RECOVERY: CategoryDefinition = {
  category: 'RECOVERY', title: 'Recovery', description: 'Breakdown, towing and roadside assistance', vehicleUsage: 'Recovery',
  menu: [],
  form: { sections: [
    s('contact', 'Contact', [
      ...contact('Contact Name', 'Email Address', { ...req, ...half }),
    ]),
    s('vehicle', 'Vehicle', [
      f('plateNo', 'Plate Number', 'text', { ...req, ...half, core: true, placeholder: 'Dubai A 12345' }),
      f('makeModel', 'Make / Model', 'text', { ...half, placeholder: 'Toyota Hiace' }),
      f('vehicleCategory', 'Vehicle Type', 'select', { ...req, ...half,
        options: ['Sedan', 'SUV', 'Van', 'Light Truck', 'Heavy Truck', 'Bus', 'Motorcycle'] }),
      f('issue', 'Problem', 'select', { ...req, ...half, core: true,
        options: ['Breakdown – will not start', 'Accident', 'Flat tyre', 'Stuck / off-road', 'Battery', 'Locked out', 'Out of fuel', 'Other'] }),
    ]),
    s('location', 'Location & Service', [
      f('origin', 'Current Vehicle Location', 'text', { ...req, core: true, placeholder: 'Road, exit number, landmark or pin' }),
      f('serviceType', 'Service Needed', 'select', { ...req, ...half, core: true,
        options: ['Tow to workshop', 'On-site jump start', 'Tyre change', 'Fuel delivery', 'Winch / extraction', 'Lockout service'] }),
      f('destination', 'Tow To', 'text', { ...half, placeholder: 'Workshop or address', showIf: { field: 'serviceType', equals: 'Tow to workshop' } }),
    ]),
    s('urgency', 'Urgency', [
      f('urgency', 'When', 'select', { ...req, ...half, core: true, options: ['Now (emergency)', 'Within 2 hours', 'Scheduled'] }),
      f('startDate', 'Date', 'date', { ...half, showIf: { field: 'urgency', equals: 'Scheduled' } }),
      f('pickupTime', 'Time', 'time', { ...half, showIf: { field: 'urgency', equals: 'Scheduled' } }),
      f('onHighway', 'Vehicle is on a highway', 'toggle', { hint: 'Flagged for safety; police may also need to be informed' }),
      f('passengersStranded', 'Passengers waiting with the vehicle', 'toggle'),
      f('notes', 'Notes', 'textarea', { placeholder: 'Anything the recovery driver should know' }),
    ]),
  ] },
};

export const CATEGORY_DEFINITIONS: Record<TransportCategory, CategoryDefinition> = {
  RAC, LEASING, LIMOUSINE, STAFF_TRANSPORT, EXECUTIVE, LOGISTICS, SCHOOL_BUS, RECOVERY,
};

/** Pages every category gets in the Customer Portal, before its own menu. */
export const COMMON_MENU = ['New request', 'Active requests', 'History'];
