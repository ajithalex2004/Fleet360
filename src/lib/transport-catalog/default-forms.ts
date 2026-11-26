/**
 * Default Transport request forms, one per category.
 *
 * Rent-a-Car, Leasing, Staff Transport, Executive Vehicles, Logistics and
 * School Bus come from the Booking Portal's New Booking forms
 * (src/app/(app)/booking-portal/new/page.tsx), with their show/hide rules
 * turned into data. Limousine and Recovery are new.
 *
 * `core` marks the fields a request cannot be routed without; tenants can
 * hide or relax every other field (tenant_transport_categories).
 * `menu` lists the category's own Customer Portal pages, shown after the
 * common New request / Active requests / History (built in phase 3c).
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

const RAC: CategoryDefinition = {
  category: 'RAC', title: 'Rent-a-Car', description: 'Short-term vehicle rental', vehicleUsage: 'Rental',
  menu: ['Agreements', 'Invoices'],
  form: { sections: [
    s('requestor', 'Requestor Information', [
      ...contact(),
      f('emiratesId', 'Emirates ID / Passport', 'text', { ...half, placeholder: '784-XXXX-XXXXXXX-X' }),
      f('licenseNo', 'Driving License No.', 'text', { ...half, placeholder: 'License number' }),
      f('licenseExpiry', 'License Expiry', 'date', half),
    ]),
    s('vehicle', 'Vehicle Requirements', [
      f('vehicleCategory', 'Vehicle Category', 'select', { ...req, ...half, core: true,
        options: ['Economy', 'Compact', 'Mid-Size', 'Full-Size', 'SUV', '4x4', 'Van', 'Pickup Truck'] }),
      f('transmission', 'Transmission', 'select', { ...half, options: ['Automatic', 'Manual', 'No Preference'] }),
      f('fuelType', 'Fuel Type', 'select', { ...half, options: ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'No Preference'] }),
      f('additionalDriver', 'Additional Driver', 'toggle', { hint: 'Add a second authorised driver (extra fee may apply)' }),
    ]),
    s('period', 'Rental Period', [
      f('startDate', 'Pickup Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time', 'time', half),
      f('endDate', 'Return Date', 'date', half),
      f('returnTime', 'Return Time', 'time', half),
    ]),
    s('location', 'Pickup & Return Location', [
      f('origin', 'Pickup Location', 'text', { ...req, core: true, placeholder: 'Branch, hotel, or address' }),
      f('sameReturnLoc', 'Return to same location', 'toggle', { hint: 'Return the vehicle to the pickup point' }),
      f('destination', 'Return Location', 'text', { placeholder: 'Different return address', showIf: { field: 'sameReturnLoc', truthy: false } }),
    ]),
    notes('Additional Requirements', 'Child seat, GPS unit, insurance type preference…'),
  ] },
};

const LEASING: CategoryDefinition = {
  category: 'LEASING', title: 'Leasing', description: 'Long-term fleet lease for companies', vehicleUsage: 'Leasing',
  menu: ['Contracts', 'Invoices', 'Documents'],
  form: { sections: [
    s('company', 'Company & Contact', [
      f('companyName', 'Company / Organisation', 'text', { ...req, ...half, placeholder: 'Legal company name' }),
      f('requestorName', 'Contact Person', 'text', { ...req, ...half, placeholder: 'Your full name' }),
      f('requestorEmail', 'Email Address', 'email', { ...req, ...half, placeholder: 'contact@company.com' }),
      f('phone', 'Direct Phone', 'tel', { ...half, placeholder: '+971 4 000 0000' }),
      f('tradeNo', 'Trade License No.', 'text', { ...half, placeholder: 'CN-XXXXXXX' }),
      f('vatNo', 'TRN / VAT No.', 'text', { ...half, placeholder: '100XXXXXXXXX' }),
    ]),
    s('fleet', 'Fleet Requirements', [
      f('vehicleCategory', 'Vehicle Type', 'select', { ...req, ...half, core: true,
        options: ['Compact Sedan', 'Mid-Size Sedan', 'SUV', 'Van (7-seater)', 'Mini-Bus', 'Bus', 'Pickup Truck', 'Mixed Fleet'] }),
      f('quantity', 'Number of Vehicles', 'number', { ...req, ...half, core: true, placeholder: '1', unit: 'vehicles' }),
      f('leaseDuration', 'Lease Duration', 'select', { ...req, ...half, core: true,
        options: ['12 months', '18 months', '24 months', '36 months', '48 months', '60 months'] }),
      f('startDate', 'Requested Start Date', 'date', { ...req, ...half, core: true }),
      f('monthlyBudget', 'Monthly Budget (AED)', 'number', { ...half, placeholder: '3000', unit: 'AED/mo' }),
      f('mileagePerMonth', 'Monthly Mileage', 'select', { ...half,
        options: ['Up to 2,000 km', '2,001–3,500 km', '3,501–5,000 km', '5,001–8,000 km', 'Unlimited'] }),
    ]),
    s('preferences', 'Vehicle Preferences', [
      f('preferredBrand', 'Preferred Brand(s)', 'text', { ...half, placeholder: 'Toyota, Honda, Hyundai…' }),
      f('fuelType', 'Fuel Type', 'select', { ...half, options: ['Petrol', 'Hybrid', 'Electric', 'Diesel', 'No Preference'] }),
      f('transmission', 'Transmission', 'select', { ...half, options: ['Automatic', 'Manual', 'No Preference'] }),
      f('color', 'Colour Preference', 'text', { ...half, placeholder: 'White, Silver, No preference' }),
    ]),
    s('inclusions', 'Contract Inclusions', [
      f('insuranceIncluded', 'Comprehensive Insurance', 'toggle', { hint: 'Third-party and comprehensive insurance in the monthly rate' }),
      f('maintenanceIncluded', 'Full Maintenance', 'toggle', { hint: 'Scheduled service, tyres and repairs included' }),
      f('salikIncluded', 'Salik / Tolls', 'toggle', { hint: 'Include Salik toll charges' }),
      f('trafficFineIncluded', 'Traffic Fine Management', 'toggle', { hint: 'Traffic fines handled through the leasing company' }),
    ]),
    notes('Additional Notes', 'Delivery location, configurations, corporate rate requirements…'),
  ] },
};

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

const STAFF_TRANSPORT: CategoryDefinition = {
  category: 'STAFF_TRANSPORT', title: 'Staff Transport', description: 'Scheduled shuttle and bus service for employees', vehicleUsage: 'Staff Transport',
  menu: ['Routes & schedules'],
  form: { sections: [
    s('employee', 'Employee Information', [
      ...contact('Employee Name', 'Work Email'),
      f('department', 'Department', 'text', { ...half, placeholder: 'IT, Finance, HR…' }),
      f('employeeId', 'Employee ID', 'text', { ...half, placeholder: 'EMP-XXXXX' }),
      f('shiftType', 'Shift Type', 'select', { ...half,
        options: ['Morning (06:00–14:00)', 'Afternoon (14:00–22:00)', 'Night (22:00–06:00)', 'Standard (09:00–18:00)', 'Split Shift'] }),
    ]),
    s('route', 'Route Details', [
      f('origin', 'Home Pickup Area / Zone', 'text', { ...req, core: true, placeholder: 'Residential area, landmark or street' }),
      f('destination', 'Office / Workplace', 'text', { ...req, core: true, placeholder: 'Office building, site, facility' }),
    ]),
    s('schedule', 'Schedule', [
      f('workDays', 'Working Days', 'select', { ...req, ...half,
        options: ['Sunday–Thursday', 'Monday–Friday', 'Monday–Saturday', 'Sunday–Saturday', 'Custom'] }),
      f('pickupTime', 'Morning Pickup Time', 'time', { ...req, ...half, core: true }),
      f('returnTime', 'Evening Return Time', 'time', half),
      f('startDate', 'Service Start Date', 'date', { ...req, ...half, core: true }),
      f('endDate', 'Service End Date', 'date', { hint: 'Leave blank for open-ended service' }),
    ]),
    s('additional', 'Additional Requirements', [
      f('accessibilityNeeds', 'Accessibility / Special Needs', 'select', { ...half,
        options: ['None', 'Wheelchair Accessible', 'Extra Leg Room', 'Hearing Impaired', 'Other'] }),
      f('genderPreference', 'Driver Gender Preference', 'select', { ...half, options: ['No Preference', 'Male Driver', 'Female Driver'] }),
      f('notes', 'Additional Notes', 'textarea', { placeholder: 'Exact pickup point, gate number, building entry instructions…' }),
    ]),
  ] },
};

const EXECUTIVE: CategoryDefinition = {
  category: 'EXECUTIVE', title: 'Executive Vehicles', description: 'Premium chauffeur-driven vehicles for VIP travel', vehicleUsage: 'Executive Service',
  menu: [],
  form: { sections: [
    s('requestor', 'Requestor & Authorisation', [
      ...contact('Booking Contact Name', 'Email Address'),
      f('department', 'Department / Cost Center', 'text', { ...half, placeholder: 'C-Suite, Exec Office…' }),
    ]),
    s('passenger', 'Passenger Details', [
      f('passengerName', 'Passenger / Executive Name', 'text', { ...half, placeholder: 'Name of the traveller', hint: 'Leave blank if same as requestor' }),
      f('vipLevel', 'VIP Level', 'select', { ...half,
        options: ['C-Suite / Board', 'Senior Management', 'Government Official', 'Client / Guest', 'Standard Executive'] }),
      f('paxCount', 'No. of Passengers', 'number', { ...half, placeholder: '1', unit: 'pax' }),
      f('chauffeurRequired', 'Dedicated Chauffeur', 'toggle', { hint: 'Assign a dedicated chauffeur for this booking' }),
    ]),
    s('vehicle', 'Vehicle & Trip Type', [
      f('vehicleCategory', 'Vehicle Class', 'select', { ...req, ...half, core: true,
        options: ['Business Sedan', 'Luxury Sedan', 'Luxury SUV', 'Executive Van (MPV)', 'Stretch Limousine', 'SUV Convoy'] }),
      f('tripType', 'Trip Type', 'select', { ...req, ...half,
        options: ['Airport Transfer (Arrival)', 'Airport Transfer (Departure)', 'City Transfer', 'Event / Function', 'Road Show', 'Full Day', 'Multi-Day'] }),
    ]),
    s('outbound', 'Outbound Journey', [
      f('origin', 'Pickup Location', 'text', { ...req, core: true, placeholder: 'Hotel, office, terminal, gate' }),
      f('destination', 'Drop-off Location', 'text', { ...req, core: true, placeholder: 'Destination address or terminal' }),
      f('startDate', 'Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time', 'time', { ...req, ...half, core: true }),
      f('flightNo', 'Flight Number', 'text', { ...half, placeholder: 'EK001', hint: 'For airport transfers — enables flight tracking' }),
      f('terminal', 'Terminal', 'select', { ...half,
        options: ['Terminal 1 (DXB)', 'Terminal 2 (DXB)', 'Terminal 3 (DXB)', 'AUH Terminal A', 'AUH Terminal B', 'SHJ Airport', 'Other'] }),
    ]),
    s('return', 'Return Journey', [
      f('returnRequired', 'Return Transfer Required', 'toggle', { hint: 'Enable if a return trip is needed' }),
      f('endDate', 'Return Date', 'date', { ...half, showIf: { field: 'returnRequired', truthy: true } }),
      f('returnTime', 'Return Time', 'time', { ...half, showIf: { field: 'returnRequired', truthy: true } }),
      f('returnFrom', 'Return Pickup', 'text', { placeholder: 'Pickup for return', showIf: { field: 'returnRequired', truthy: true } }),
    ]),
    s('extras', 'In-Vehicle Extras', [
      f('extras', 'Special Requests', 'select', { ...half,
        options: ['None', 'Mineral Water', 'Newspapers / Magazines', 'WiFi Hotspot', 'Name Board / Signage', 'Flowers / Gifts', 'Cold Towels'] }),
      f('notes', 'Additional Instructions', 'textarea', { placeholder: 'Meet & greet, preferred route, protocol notes…' }),
    ]),
  ] },
};

const LOGISTICS: CategoryDefinition = {
  category: 'LOGISTICS', title: 'Logistics', description: 'Cargo and freight transport', vehicleUsage: 'Logistics',
  menu: ['Shipments', 'Proof of delivery'],
  form: { sections: [
    s('customer', 'Customer / Requestor', [
      f('companyName', 'Company Name', 'text', { ...req, ...half, placeholder: 'Customer company' }),
      f('requestorName', 'Contact Person', 'text', { ...req, ...half, placeholder: 'Your full name' }),
      f('requestorEmail', 'Email Address', 'email', { ...req, ...half, placeholder: 'logistics@company.com' }),
      f('phone', 'Contact Number', 'tel', { ...half, placeholder: '+971 50 000 0000' }),
    ]),
    s('classification', 'Shipment Classification', [
      f('shipmentType', 'Shipment Type', 'select', { ...req, ...half, core: true,
        options: ['FTL – Full Truck Load', 'LTL – Less than Truck Load', 'FCL – Full Container Load', 'LCL – Less than Container Load',
          'REEFER – Temperature Controlled', 'SPECIAL – Oversized / Project Cargo'],
        hint: 'The load type that best matches your shipment' }),
      f('vehicleCategory', 'Vehicle Type Required', 'select', { ...half,
        options: ['Any Available', 'Small Van (< 1 ton)', 'Medium Van (1–3 ton)', 'Light Truck (3–7 ton)', 'Heavy Truck (7–20 ton)',
          'Flatbed / Low-bed', 'Tanker', 'Reefer Truck'] }),
      f('hsCode', 'HS Code', 'text', { ...half, placeholder: 'e.g. 8471.30', hint: 'Commodity code for customs clearance' }),
      f('hsDescription', 'HS Code Description', 'text', { ...half, placeholder: 'e.g. Portable data processing machines' }),
    ]),
    s('route', 'Route & Schedule', [
      f('origin', 'Pickup / Origin Address', 'text', { ...req, core: true, placeholder: 'Warehouse or collection point' }),
      f('destination', 'Delivery / Destination Address', 'text', { ...req, core: true, placeholder: 'Final delivery address' }),
      f('startDate', 'Pickup Date', 'date', { ...req, ...half, core: true }),
      f('pickupTime', 'Pickup Time (Preferred)', 'time', half),
      f('deliveryDate', 'Expected Delivery Date', 'date', half),
      f('deliveryTime', 'Delivery Time Window', 'select', { ...half,
        options: ['Anytime', '06:00–10:00', '10:00–14:00', '14:00–18:00', '18:00–22:00', 'Before Noon', 'After Noon'] }),
    ]),
    s('cargo', 'Cargo Details', [
      f('cargoType', 'Cargo Type', 'select', { ...req, ...half,
        options: ['General Goods', 'Fragile / Breakable', 'Perishable / Cold Chain', 'Hazardous Materials', 'Heavy Machinery',
          'Documents / Parcels', 'Furniture', 'E-Commerce', 'Automotive Parts', 'Electronics', 'Pharmaceuticals'] }),
      f('cargo', 'Cargo Description', 'text', { ...req, core: true, placeholder: 'What is being transported' }),
      f('weight', 'Gross Weight', 'number', { ...half, placeholder: '500', unit: 'kg' }),
      f('cbm', 'Volume (CBM)', 'number', { ...half, placeholder: '2.5', unit: 'm³' }),
      f('dimensions', 'Dimensions (L×W×H)', 'text', { ...half, placeholder: '2m × 1.2m × 1.5m' }),
      f('pallets', 'No. of Pallets / Units', 'number', { ...half, placeholder: '10', unit: 'units' }),
      f('tempControlled', 'Temperature Controlled', 'toggle', { hint: 'Cargo needs refrigeration or controlled temperature' }),
      f('tempRange', 'Temperature Range', 'text', { ...half, placeholder: '2°C – 8°C', showIf: { field: 'tempControlled', truthy: true } }),
    ]),
    s('hazmat', 'Hazardous Materials (ADR / IMDG)', [
      f('isHazmat', 'Contains Dangerous Goods', 'toggle', { hint: 'Classified as hazardous under ADR / IMDG' }),
      f('unNumber', 'UN Number', 'text', { ...half, placeholder: 'e.g. UN1950', showIf: { field: 'isHazmat', truthy: true } }),
      f('adrClass', 'ADR / IMDG Class', 'select', { ...half, showIf: { field: 'isHazmat', truthy: true },
        options: ['Class 1 – Explosives', 'Class 2 – Gases', 'Class 3 – Flammable Liquids', 'Class 4 – Flammable Solids',
          'Class 5 – Oxidizing Substances', 'Class 6 – Toxic & Infectious', 'Class 7 – Radioactive', 'Class 8 – Corrosives',
          'Class 9 – Misc. Dangerous Goods'] }),
      f('packingGroup', 'Packing Group', 'select', { ...half, showIf: { field: 'isHazmat', truthy: true },
        options: ['PG I – Great Danger', 'PG II – Medium Danger', 'PG III – Minor Danger', 'N/A'] }),
      f('hazmatDescription', 'Proper Shipping Name', 'text', { placeholder: 'e.g. Aerosols, flammable', showIf: { field: 'isHazmat', truthy: true } }),
      f('msdsAvailable', 'MSDS / SDS Document Available', 'toggle', { showIf: { field: 'isHazmat', truthy: true } }),
    ]),
    s('service', 'Service Options', [
      f('urgentDelivery', 'Urgent / Priority Delivery', 'toggle', { hint: 'High priority — surcharge may apply' }),
      f('podRequired', 'Proof of Delivery (POD)', 'toggle', { hint: 'Signed delivery receipt required' }),
      f('insuranceReq', 'Cargo Insurance Required', 'toggle'),
      f('customsClearance', 'Customs Clearance Required', 'toggle'),
    ]),
    notes('Special Handling Instructions', 'Do not stack, fragile, loading dock required…'),
  ] },
};

const SCHOOL_BUS: CategoryDefinition = {
  category: 'SCHOOL_BUS', title: 'School Bus', description: 'Student transport registration', vehicleUsage: 'School Transport',
  menu: ['Students'],
  form: { sections: [
    s('guardian', 'Parent / Guardian', [
      ...contact('Parent / Guardian Name', 'Email Address', { ...req, ...half }),
      f('relationship', 'Relationship to Student', 'select', { ...half, options: ['Father', 'Mother', 'Guardian', 'Grandparent', 'Other'] }),
    ]),
    s('student', 'Student Information', [
      f('studentName', 'Student Full Name', 'text', { ...req, ...half, core: true, placeholder: 'Student full legal name' }),
      f('studentGrade', 'Grade / Class', 'text', { ...half, placeholder: 'Grade 5, Year 7, KG2…' }),
      f('studentAge', 'Student Age', 'number', { ...half, placeholder: '10', unit: 'years' }),
      f('studentId', 'School ID / Emirates ID', 'text', { ...half, placeholder: 'Student ID number' }),
    ]),
    s('school', 'School Details', [
      f('destination', 'School Name', 'text', { ...req, ...half, core: true, placeholder: 'Full school name' }),
      f('schoolArea', 'School Area / Zone', 'text', { ...half, placeholder: 'Al Barsha, Jumeirah, Mirdif…' }),
      f('curriculum', 'Curriculum', 'select', { ...half,
        options: ['UAE National', 'British', 'American', 'IB (International Baccalaureate)', 'Indian CBSE', 'Indian ICSE', 'Other'] }),
    ]),
    s('route', 'Pickup Route', [
      f('origin', 'Home Pickup Address', 'text', { ...req, core: true, placeholder: 'Villa / apartment address or landmark' }),
      f('pickupTime', 'Morning Pickup Time', 'time', { ...req, ...half, hint: 'Approximate preferred time' }),
      f('returnTime', 'Afternoon Return Time', 'time', half),
      f('startDate', 'Enrollment Start Date', 'date', { ...req, ...half, core: true }),
      f('endDate', 'Expected End Date', 'date', { ...half, hint: 'End of school year, or blank for the full year' }),
    ]),
    s('medical', 'Medical & Special Needs', [
      f('medicalConditions', 'Medical Conditions / Allergies', 'textarea', {
        placeholder: 'Asthma, nut allergy, diabetes — anything the driver should know',
        hint: 'Kept confidential and shared only with the assigned driver' }),
      f('specialNeeds', 'Special Needs', 'select', { ...half,
        options: ['None', 'Wheelchair Accessible', 'Extra Supervision', 'Vision Impaired', 'Hearing Impaired', 'Behavioural Support', 'Other'] }),
      f('epiPenOnBoard', 'EpiPen / Emergency Medication', 'toggle', { hint: 'The driver will be briefed' }),
    ]),
    s('emergency', 'Emergency Contact', [
      f('emergencyContact', 'Emergency Contact Name', 'text', { ...half, placeholder: 'Backup contact' }),
      f('emergencyPhone', 'Emergency Contact Number', 'tel', { ...half, placeholder: '+971 50 000 0000' }),
    ]),
    notes('Notes for Driver / Operations', 'Gate code, drop point, alternative pickup person, holidays…'),
  ] },
};

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
