/**
 * Vehicle Knowledge Base
 * Maps Make + Model → Segment, Group, Class, and suggested Type name
 * Used for smart auto-detection in the Vehicle Master form.
 *
 * Covers the most common vehicles in the UAE fleet/rental market.
 * Key normalisation: always UPPER CASE for both make and model keys.
 */

export type VehicleKnowledge = {
  segment: string;       // ECONOMY | COMPACT | MID_SIZE | FULL_SIZE | COMPACT_SUV | MID_SIZE_SUV | FULL_SIZE_SUV | LUXURY | PREMIUM | SPORTS | VAN | PICKUP | BUS | SPECIAL
  group: string;         // PASSENGER | LIGHT_COMMERCIAL | HEAVY_COMMERCIAL | BUS | MOTORCYCLE | SPECIAL
  vehicleClass: string;  // SEDAN | SUV | HATCHBACK | PICKUP | VAN | MINIBUS | ...
  suggestedType: string; // human-readable type name to help match vehicle_types table
  fuelType?: string;     // PETROL | DIESEL | ELECTRIC | HYBRID (optional default hint)
  numPassengers?: number;
};

/** Canonical make names (for display & autocomplete) */
export const KNOWN_MAKES: string[] = [
  'Toyota', 'Nissan', 'Honda', 'Hyundai', 'Kia', 'Mitsubishi',
  'Mercedes-Benz', 'BMW', 'Audi', 'Lexus', 'Infiniti', 'Cadillac',
  'Ford', 'Chevrolet', 'GMC', 'Dodge', 'Jeep',
  'Land Rover', 'Jaguar', 'Porsche', 'Maserati', 'Ferrari', 'Lamborghini',
  'Volkswagen', 'Skoda', 'SEAT', 'Volvo', 'Peugeot', 'Renault', 'Citroen',
  'Suzuki', 'Mazda', 'Subaru', 'Isuzu',
  'BYD', 'MG', 'Chery', 'Geely',
];

/** Models grouped by make (for autocomplete filtering) */
export const MODELS_BY_MAKE: Record<string, string[]> = {
  TOYOTA: [
    'Yaris', 'Corolla', 'Camry', 'Avalon',
    'RAV4', 'Fortuner', 'Land Cruiser Prado', 'Land Cruiser',
    'Hilux', 'Hiace', 'Coaster', 'FJ Cruiser',
    'Prius', 'C-HR', 'Rush', 'Innova', 'Veloz',
  ],
  NISSAN: [
    'Sunny', 'Sentra', 'Altima', 'Maxima', 'Tiida',
    'X-Trail', 'Qashqai', 'Pathfinder', 'Patrol', 'Murano',
    'Navara', 'Urvan', 'Armada', 'Kicks',
  ],
  HONDA: [
    'City', 'Civic', 'Accord', 'Odyssey',
    'CR-V', 'Pilot', 'HR-V', 'Passport',
    'Jazz', 'Fit',
  ],
  HYUNDAI: [
    'Accent', 'Elantra', 'Sonata', 'Azera',
    'Tucson', 'Santa Fe', 'Palisade', 'Creta', 'Venue',
    'Staria', 'H-1',
  ],
  KIA: [
    'Pegas', 'Cerato', 'Optima', 'K5', 'Stinger', 'Cadenza',
    'Sportage', 'Sorento', 'Telluride', 'Carnival', 'Sonet',
  ],
  MITSUBISHI: [
    'Attrage', 'Lancer', 'Galant',
    'Eclipse Cross', 'Outlander', 'Pajero', 'Pajero Sport',
    'L200', 'Rosa',
  ],
  'MERCEDES-BENZ': [
    'A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'CLS',
    'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Class', 'EQC', 'EQS',
    'Vito', 'Sprinter', 'Metris',
  ],
  BMW: [
    '1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '7 Series', '8 Series',
    'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7',
    'i3', 'i5', 'i7', 'M3', 'M5',
  ],
  AUDI: [
    'A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'TT', 'R8',
    'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron',
  ],
  LEXUS: [
    'IS', 'ES', 'GS', 'LS', 'LC', 'RC',
    'NX', 'RX', 'GX', 'LX',
  ],
  INFINITI: [
    'Q30', 'Q50', 'Q60', 'Q70',
    'QX30', 'QX50', 'QX60', 'QX80',
  ],
  FORD: [
    'Figo', 'Focus', 'Fusion', 'Taurus', 'Mustang',
    'EcoSport', 'Escape', 'Edge', 'Explorer', 'Expedition', 'Bronco',
    'Ranger', 'F-150', 'Transit',
  ],
  CHEVROLET: [
    'Spark', 'Aveo', 'Cruze', 'Malibu', 'Impala',
    'Trax', 'Equinox', 'Blazer', 'Traverse', 'Tahoe', 'Suburban',
    'Colorado', 'Silverado', 'Captiva',
  ],
  GMC: ['Terrain', 'Acadia', 'Yukon', 'Sierra', 'Canyon'],
  DODGE: ['Charger', 'Challenger', 'Durango', 'Journey'],
  JEEP: ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler'],
  'LAND ROVER': ['Discovery Sport', 'Discovery', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover', 'Defender'],
  JAGUAR: ['XE', 'XF', 'XJ', 'F-Pace', 'E-Pace', 'I-Pace', 'F-Type'],
  PORSCHE: ['Cayenne', 'Macan', 'Panamera', '911', 'Taycan'],
  VOLKSWAGEN: ['Polo', 'Golf', 'Passat', 'Arteon', 'Tiguan', 'Touareg', 'Touareg R'],
  SUZUKI: ['Swift', 'Baleno', 'Ciaz', 'Jimny', 'Vitara', 'Ertiga'],
  MAZDA: ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-5', 'CX-9', 'MX-5'],
  ISUZU: ['D-Max', 'mu-X'],
  MG: ['MG3', 'MG5', 'MG6', 'ZS', 'HS', 'RX5'],
  BYD: ['Atto 3', 'Han', 'Tang', 'Seal', 'Dolphin'],
};

/** ────────────────────────────────────────────────────────────────────────────
 *  Core lookup table:  MAKE (upper) → MODEL (upper) → VehicleKnowledge
 * ──────────────────────────────────────────────────────────────────────────── */
const KB: Record<string, Record<string, VehicleKnowledge>> = {

  // ── TOYOTA ────────────────────────────────────────────────────────────────
  TOYOTA: {
    YARIS:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    COROLLA:             { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    CAMRY:               { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    AVALON:              { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    PRIUS:               { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Hybrid Hatchback',  fuelType:'HYBRID', numPassengers:5 },
    'C-HR':              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    RAV4:                { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    RUSH:                { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:7 },
    INNOVA:              { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'PETROL', numPassengers:8 },
    VELOZ:               { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'PETROL', numPassengers:7 },
    FORTUNER:            { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'DIESEL', numPassengers:7 },
    'LAND CRUISER PRADO':{ segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'DIESEL', numPassengers:7 },
    'LAND CRUISER':      { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'DIESEL', numPassengers:8 },
    'FJ CRUISER':        { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    HILUX:               { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    HIACE:               { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Cargo Van',         fuelType:'DIESEL', numPassengers:12 },
    COASTER:             { segment:'BUS',            group:'BUS',               vehicleClass:'MINIBUS',   suggestedType:'Minibus',           fuelType:'DIESEL', numPassengers:30 },
  },

  // ── NISSAN ────────────────────────────────────────────────────────────────
  NISSAN: {
    SUNNY:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    TIIDA:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    SENTRA:              { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    ALTIMA:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    MAXIMA:              { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    KICKS:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    QASHQAI:             { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    'X-TRAIL':           { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:7 },
    MURANO:              { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    PATHFINDER:          { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    PATROL:              { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    ARMADA:              { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    NAVARA:              { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    URVAN:               { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Cargo Van',         fuelType:'DIESEL', numPassengers:12 },
  },

  // ── HONDA ─────────────────────────────────────────────────────────────────
  HONDA: {
    JAZZ:                { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    FIT:                 { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    CITY:                { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    CIVIC:               { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    ACCORD:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    ODYSSEY:             { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'PETROL', numPassengers:8 },
    'HR-V':              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    'CR-V':              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    PASSPORT:            { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    PILOT:               { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:8 },
  },

  // ── HYUNDAI ───────────────────────────────────────────────────────────────
  HYUNDAI: {
    ACCENT:              { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    ELANTRA:             { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    SONATA:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    AZERA:               { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    VENUE:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    CRETA:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    TUCSON:              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    'SANTA FE':          { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    PALISADE:            { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    STARIA:              { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'DIESEL', numPassengers:11 },
    'H-1':               { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Cargo Van',         fuelType:'DIESEL', numPassengers:12 },
  },

  // ── KIA ───────────────────────────────────────────────────────────────────
  KIA: {
    PEGAS:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    PICANTO:             { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:4 },
    CERATO:              { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    OPTIMA:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    K5:                  { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    STINGER:             { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Sports Sedan',      fuelType:'PETROL', numPassengers:5 },
    CADENZA:             { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    SONET:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    SPORTAGE:            { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    SORENTO:             { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    TELLURIDE:           { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    CARNIVAL:            { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'PETROL', numPassengers:8 },
  },

  // ── MITSUBISHI ────────────────────────────────────────────────────────────
  MITSUBISHI: {
    ATTRAGE:             { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    LANCER:              { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    GALANT:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    'ECLIPSE CROSS':     { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    OUTLANDER:           { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    'PAJERO SPORT':      { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'DIESEL', numPassengers:7 },
    PAJERO:              { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'DIESEL', numPassengers:7 },
    L200:                { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    ROSA:                { segment:'BUS',            group:'BUS',               vehicleClass:'MINIBUS',   suggestedType:'Minibus',           fuelType:'DIESEL', numPassengers:26 },
  },

  // ── MERCEDES-BENZ ─────────────────────────────────────────────────────────
  'MERCEDES-BENZ': {
    'A-CLASS':           { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Luxury Hatchback',  fuelType:'PETROL', numPassengers:5 },
    'B-CLASS':           { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Luxury Hatchback',  fuelType:'PETROL', numPassengers:5 },
    CLA:                 { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:5 },
    'C-CLASS':           { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    CLS:                 { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:5 },
    'E-CLASS':           { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    'S-CLASS':           { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Premium Sedan',     fuelType:'PETROL', numPassengers:5 },
    GLA:                 { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    GLB:                 { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:7 },
    GLC:                 { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    GLE:                 { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:5 },
    GLS:                 { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Full-size SUV',fuelType:'PETROL',numPassengers:7},
    'G-CLASS':           { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Premium SUV',       fuelType:'PETROL', numPassengers:5 },
    EQC:                 { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Electric SUV',      fuelType:'ELECTRIC',numPassengers:5},
    EQS:                 { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Electric Premium',  fuelType:'ELECTRIC',numPassengers:5},
    VITO:                { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Luxury Van',        fuelType:'DIESEL', numPassengers:9 },
    SPRINTER:            { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Cargo Van',         fuelType:'DIESEL', numPassengers:9 },
  },

  // ── BMW ───────────────────────────────────────────────────────────────────
  BMW: {
    '1 SERIES':          { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Luxury Hatchback',  fuelType:'PETROL', numPassengers:5 },
    '2 SERIES':          { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:4 },
    '3 SERIES':          { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    '4 SERIES':          { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:4 },
    '5 SERIES':          { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    '7 SERIES':          { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Premium Sedan',     fuelType:'PETROL', numPassengers:5 },
    '8 SERIES':          { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Premium Coupe',     fuelType:'PETROL', numPassengers:4 },
    M3:                  { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Sports Sedan',      fuelType:'PETROL', numPassengers:5 },
    M5:                  { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Sports Sedan',      fuelType:'PETROL', numPassengers:5 },
    X1:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    X2:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    X3:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    X4:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    X5:                  { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:5 },
    X6:                  { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:5 },
    X7:                  { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Full-size SUV',fuelType:'PETROL',numPassengers:7},
  },

  // ── AUDI ──────────────────────────────────────────────────────────────────
  AUDI: {
    A1:                  { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Luxury Hatchback',  fuelType:'PETROL', numPassengers:5 },
    A3:                  { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Compact Sedan',fuelType:'PETROL',numPassengers:5},
    A4:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    A5:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:5 },
    A6:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    A7:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Luxury Coupe',      fuelType:'PETROL', numPassengers:5 },
    A8:                  { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Premium Sedan',     fuelType:'PETROL', numPassengers:5 },
    R8:                  { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Sports Car',        fuelType:'PETROL', numPassengers:2 },
    TT:                  { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Sports Coupe',      fuelType:'PETROL', numPassengers:4 },
    Q2:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    Q3:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    Q5:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    Q7:                  { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:7 },
    Q8:                  { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Full-size SUV',fuelType:'PETROL',numPassengers:5},
  },

  // ── LEXUS ─────────────────────────────────────────────────────────────────
  LEXUS: {
    IS:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    ES:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'HYBRID', numPassengers:5 },
    GS:                  { segment:'LUXURY',         group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Luxury Sedan',      fuelType:'PETROL', numPassengers:5 },
    LS:                  { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Premium Sedan',     fuelType:'HYBRID', numPassengers:5 },
    LC:                  { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Premium Coupe',     fuelType:'HYBRID', numPassengers:4 },
    NX:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'HYBRID', numPassengers:5 },
    RX:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'HYBRID', numPassengers:5 },
    GX:                  { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:7 },
    LX:                  { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Full-size SUV',fuelType:'PETROL',numPassengers:7},
  },

  // ── FORD ──────────────────────────────────────────────────────────────────
  FORD: {
    FIGO:                { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    FOCUS:               { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    FUSION:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    TAURUS:              { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    MUSTANG:             { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Sports Car',        fuelType:'PETROL', numPassengers:4 },
    ECOSPORT:            { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    ESCAPE:              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    EDGE:                { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    EXPLORER:            { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    EXPEDITION:          { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    BRONCO:              { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    RANGER:              { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    'F-150':             { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'PETROL', numPassengers:5 },
    TRANSIT:             { segment:'VAN',            group:'LIGHT_COMMERCIAL',  vehicleClass:'VAN',       suggestedType:'Cargo Van',         fuelType:'DIESEL', numPassengers:9 },
  },

  // ── CHEVROLET ─────────────────────────────────────────────────────────────
  CHEVROLET: {
    SPARK:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:4 },
    AVEO:                { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Economy Sedan',     fuelType:'PETROL', numPassengers:5 },
    CRUZE:               { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    MALIBU:              { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    IMPALA:              { segment:'FULL_SIZE',      group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Full-size Sedan',   fuelType:'PETROL', numPassengers:5 },
    CAPTIVA:             { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:7 },
    TRAX:                { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    EQUINOX:             { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    BLAZER:              { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    TRAVERSE:            { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:8 },
    TAHOE:               { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    SUBURBAN:            { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:9 },
    COLORADO:            { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    SILVERADO:           { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'PETROL', numPassengers:5 },
  },

  // ── GMC ───────────────────────────────────────────────────────────────────
  GMC: {
    TERRAIN:             { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    ACADIA:              { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:7 },
    YUKON:               { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Full-size SUV',     fuelType:'PETROL', numPassengers:8 },
    SIERRA:              { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'PETROL', numPassengers:5 },
    CANYON:              { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
  },

  // ── JEEP ──────────────────────────────────────────────────────────────────
  JEEP: {
    RENEGADE:            { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    COMPASS:             { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    CHEROKEE:            { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    'GRAND CHEROKEE':    { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'PETROL', numPassengers:5 },
    WRANGLER:            { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Off-road SUV',      fuelType:'PETROL', numPassengers:5 },
  },

  // ── LAND ROVER ────────────────────────────────────────────────────────────
  'LAND ROVER': {
    'DISCOVERY SPORT':   { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    'RANGE ROVER EVOQUE':{ segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Compact SUV',fuelType:'PETROL', numPassengers:5 },
    DISCOVERY:           { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'DIESEL',numPassengers:7 },
    'RANGE ROVER SPORT': { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Luxury Mid-size SUV',fuelType:'PETROL',numPassengers:5 },
    'RANGE ROVER':       { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Premium Full-size SUV',fuelType:'PETROL',numPassengers:5},
    DEFENDER:            { segment:'FULL_SIZE_SUV',  group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Off-road SUV',      fuelType:'DIESEL', numPassengers:5 },
  },

  // ── PORSCHE ───────────────────────────────────────────────────────────────
  PORSCHE: {
    MACAN:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Sports Compact SUV',fuelType:'PETROL', numPassengers:5 },
    CAYENNE:             { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Sports Mid-size SUV',fuelType:'PETROL',numPassengers:5 },
    PANAMERA:            { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Premium Sedan',     fuelType:'PETROL', numPassengers:4 },
    '911':               { segment:'SPORTS',         group:'PASSENGER',         vehicleClass:'COUPE',     suggestedType:'Sports Car',        fuelType:'PETROL', numPassengers:4 },
    TAYCAN:              { segment:'PREMIUM',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Electric Premium',  fuelType:'ELECTRIC',numPassengers:4},
  },

  // ── SUZUKI ────────────────────────────────────────────────────────────────
  SUZUKI: {
    SWIFT:               { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    BALENO:              { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    CIAZ:                { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    JIMNY:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:4 },
    VITARA:              { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    ERTIGA:              { segment:'VAN',            group:'PASSENGER',         vehicleClass:'MPV',       suggestedType:'People Mover',      fuelType:'PETROL', numPassengers:7 },
  },

  // ── ISUZU ─────────────────────────────────────────────────────────────────
  ISUZU: {
    'D-MAX':             { segment:'PICKUP',         group:'LIGHT_COMMERCIAL',  vehicleClass:'PICKUP',    suggestedType:'Pickup Truck',       fuelType:'DIESEL', numPassengers:5 },
    'MU-X':              { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Mid-size SUV',      fuelType:'DIESEL', numPassengers:7 },
  },

  // ── MG ────────────────────────────────────────────────────────────────────
  MG: {
    MG3:                 { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Economy Hatchback', fuelType:'PETROL', numPassengers:5 },
    MG5:                 { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Compact Sedan',     fuelType:'PETROL', numPassengers:5 },
    MG6:                 { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Mid-size Sedan',    fuelType:'PETROL', numPassengers:5 },
    ZS:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
    HS:                  { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Compact SUV',       fuelType:'PETROL', numPassengers:5 },
  },

  // ── BYD ───────────────────────────────────────────────────────────────────
  BYD: {
    DOLPHIN:             { segment:'ECONOMY',       group:'PASSENGER',         vehicleClass:'HATCHBACK', suggestedType:'Electric Economy',  fuelType:'ELECTRIC',numPassengers:5 },
    ATTO3:               { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Electric Compact SUV',fuelType:'ELECTRIC',numPassengers:5},
    'ATTO 3':            { segment:'COMPACT_SUV',    group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Electric Compact SUV',fuelType:'ELECTRIC',numPassengers:5},
    SEAL:                { segment:'COMPACT',        group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Electric Compact',  fuelType:'ELECTRIC',numPassengers:5 },
    HAN:                 { segment:'MID_SIZE',       group:'PASSENGER',         vehicleClass:'SEDAN',     suggestedType:'Electric Mid-size', fuelType:'ELECTRIC',numPassengers:5 },
    TANG:                { segment:'MID_SIZE_SUV',   group:'PASSENGER',         vehicleClass:'SUV',       suggestedType:'Electric Mid-size SUV',fuelType:'ELECTRIC',numPassengers:7},
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  COST & EMISSIONS REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CO₂ emission multiplier relative to a petrol baseline.
 * Multiply the segment's petrol CO₂ value (g/km) by this factor
 * to get the adjusted CO₂ for a given fuel type.
 *
 * Sources: IPCC / DEFRA emission factors, UAE RTA green vehicle standards.
 */
export const CO2_BY_FUEL_TYPE: Record<string, number> = {
  PETROL:   1.00,   // baseline
  DIESEL:   0.88,   // ~12 % lower g/km (higher energy density)
  HYBRID:   0.62,   // ~38 % reduction vs petrol baseline
  ELECTRIC: 0.00,   // zero tailpipe emissions
  CNG:      0.78,   // ~22 % lower than petrol
  LPG:      0.90,   // ~10 % lower than petrol
};

/**
 * Per-segment average benchmarks for UAE fleet operations.
 *
 * costPerKm    — total operating cost (AED/km): fuel + depreciation + maintenance
 * idleFuel     — fuel consumed at idle / stationary engine (L/hr)
 * co2Petrol    — CO₂ emission on petrol baseline (g/km); multiply by CO2_BY_FUEL_TYPE
 * effKml       — fuel efficiency (km per litre) for petrol baseline
 * maxSpeedKmh  — typical governed / tested top speed (km/h)
 */
export const SEGMENT_DEFAULTS: Record<string, {
  costPerKm: number;
  idleFuel: number;
  co2Petrol: number;
  effKml: number;
  maxSpeedKmh: number;
}> = {
  ECONOMY:       { costPerKm: 0.48, idleFuel: 0.65, co2Petrol: 118, effKml: 16.0, maxSpeedKmh: 160 },
  COMPACT:       { costPerKm: 0.58, idleFuel: 0.75, co2Petrol: 138, effKml: 14.0, maxSpeedKmh: 180 },
  MID_SIZE:      { costPerKm: 0.72, idleFuel: 0.90, co2Petrol: 162, effKml: 12.0, maxSpeedKmh: 200 },
  FULL_SIZE:     { costPerKm: 0.90, idleFuel: 1.05, co2Petrol: 185, effKml: 10.5, maxSpeedKmh: 210 },
  COMPACT_SUV:   { costPerKm: 0.78, idleFuel: 0.95, co2Petrol: 168, effKml: 12.5, maxSpeedKmh: 185 },
  MID_SIZE_SUV:  { costPerKm: 0.95, idleFuel: 1.15, co2Petrol: 198, effKml: 10.0, maxSpeedKmh: 195 },
  FULL_SIZE_SUV: { costPerKm: 1.20, idleFuel: 1.40, co2Petrol: 225, effKml:  8.5, maxSpeedKmh: 200 },
  LUXURY:        { costPerKm: 1.65, idleFuel: 1.20, co2Petrol: 195, effKml: 11.0, maxSpeedKmh: 240 },
  PREMIUM:       { costPerKm: 2.50, idleFuel: 1.50, co2Petrol: 240, effKml:  8.0, maxSpeedKmh: 260 },
  SPORTS:        { costPerKm: 2.20, idleFuel: 1.30, co2Petrol: 220, effKml:  9.0, maxSpeedKmh: 280 },
  VAN:           { costPerKm: 0.95, idleFuel: 1.20, co2Petrol: 210, effKml:  9.5, maxSpeedKmh: 160 },
  PICKUP:        { costPerKm: 0.82, idleFuel: 1.10, co2Petrol: 200, effKml: 10.0, maxSpeedKmh: 170 },
  BUS:           { costPerKm: 1.80, idleFuel: 2.50, co2Petrol: 320, effKml:  5.5, maxSpeedKmh: 120 },
  SPECIAL:       { costPerKm: 2.50, idleFuel: 3.00, co2Petrol: 380, effKml:  4.0, maxSpeedKmh: 130 },
};

/**
 * Compute auto-fill values for the Vehicle Type Master form.
 *
 * Returns costPerKm, idleFuelConsumption, co2EmissionFactor, fuelEfficiencyKml,
 * and maxSpeedKmh — adjusted for the given fuelType.
 */
export function getSegmentDefaults(
  segment: string,
  fuelType: string = 'PETROL',
): {
  costPerKm: number;
  idleFuelConsumption: number;
  co2EmissionFactor: number;
  fuelEfficiencyKml: number;
  maxSpeedKmh: number;
} | null {
  const d = SEGMENT_DEFAULTS[segment];
  if (!d) return null;
  const co2Factor = CO2_BY_FUEL_TYPE[fuelType] ?? 1.0;
  // Electric vehicles have better efficiency expressed differently; use 0 for pure EV
  const efficiencyFactor = fuelType === 'ELECTRIC' ? 0 : fuelType === 'HYBRID' ? 1.25 : fuelType === 'DIESEL' ? 1.15 : 1.0;
  return {
    costPerKm:          Math.round(d.costPerKm * 1000) / 1000,
    idleFuelConsumption: fuelType === 'ELECTRIC' ? 0 : Math.round(d.idleFuel * 10) / 10,
    co2EmissionFactor:  Math.round(d.co2Petrol * co2Factor),
    fuelEfficiencyKml:  fuelType === 'ELECTRIC' ? 0 : Math.round(d.effKml * efficiencyFactor * 10) / 10,
    maxSpeedKmh:        d.maxSpeedKmh,
  };
}

/**
 * Look up a vehicle in the knowledge base.
 * Normalises make and model to uppercase for matching.
 * Returns null if not found.
 */
export function lookupVehicle(make: string, model: string): VehicleKnowledge | null {
  const makeKey  = make.trim().toUpperCase();
  const modelKey = model.trim().toUpperCase();
  const makeData = KB[makeKey];
  if (!makeData) return null;
  // Exact match first
  if (makeData[modelKey]) return makeData[modelKey];
  // Partial match: model key starts with the typed model
  const partialKey = Object.keys(makeData).find(k =>
    k.startsWith(modelKey) || modelKey.startsWith(k)
  );
  return partialKey ? makeData[partialKey] : null;
}

/**
 * Get model suggestions for a given make.
 */
export function getModelsForMake(make: string): string[] {
  const key = make.trim().toUpperCase();
  return MODELS_BY_MAKE[key] ?? [];
}
