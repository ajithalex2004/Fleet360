// ============================================================
// Fleet360 - Vehicle Master Data
// Vehicle Groups, Types, Makes, Models with classification
// ============================================================

export interface VehicleGroupDef {
  code: string;
  label: string;
  icon: string;
  color: string;
  types: string[];
}

export const VEHICLE_GROUPS: VehicleGroupDef[] = [
  {
    code: 'LIGHT_VEHICLE',
    label: 'Light Vehicle',
    icon: 'L',
    color: 'from-blue-500 to-indigo-600',
    types: ['SEDAN', 'HATCHBACK', 'SUV', 'CROSSOVER', 'COUPE', 'CONVERTIBLE', 'STATION_WAGON'],
  },
  {
    code: 'PASSENGER_VEHICLE',
    label: 'Passenger Vehicle',
    icon: 'P',
    color: 'from-emerald-500 to-teal-600',
    types: ['MINIVAN', 'MPV', 'VAN', 'BUS', 'MINIBUS', 'COACH'],
  },
  {
    code: 'COMMERCIAL_VEHICLE',
    label: 'Commercial Vehicle',
    icon: 'C',
    color: 'from-amber-500 to-orange-600',
    types: ['PICKUP', 'LIGHT_TRUCK', 'MEDIUM_TRUCK', 'HEAVY_TRUCK', 'FLATBED', 'BOX_TRUCK', 'TANKER', 'TIPPER'],
  },
  {
    code: 'CONSTRUCTION_VEHICLE',
    label: 'Construction Vehicle',
    icon: 'X',
    color: 'from-yellow-500 to-amber-600',
    types: ['EXCAVATOR', 'CRANE', 'BULLDOZER', 'LOADER', 'FORKLIFT', 'COMPACTOR', 'GRADER', 'CONCRETE_MIXER'],
  },
  {
    code: 'LUXURY_VEHICLE',
    label: 'Luxury Vehicle',
    icon: 'V',
    color: 'from-violet-500 to-purple-600',
    types: ['EXECUTIVE_SEDAN', 'LIMOUSINE', 'LUXURY_SUV', 'SUPERCAR', 'HYPERCAR'],
  },
  {
    code: 'SPECIALTY_VEHICLE',
    label: 'Specialty Vehicle',
    icon: 'S',
    color: 'from-rose-500 to-pink-600',
    types: ['AMBULANCE', 'FIRE_TRUCK', 'POLICE', 'ARMORED', 'REFRIGERATED', 'MOBILE_WORKSHOP'],
  },
  {
    code: 'TWO_WHEELER',
    label: 'Two-Wheeler',
    icon: 'M',
    color: 'from-slate-500 to-slate-600',
    types: ['MOTORCYCLE', 'SCOOTER', 'ELECTRIC_BIKE', 'DELIVERY_BIKE'],
  },
];

// Make  Model  Groups mapping
export interface MakeDef {
  make: string;
  models: { model: string; groups: string[] }[];
}

export const VEHICLE_MAKES: MakeDef[] = [
  {
    make: 'Toyota',
    models: [
      { model: 'Camry',          groups: ['LIGHT_VEHICLE'] },
      { model: 'Corolla',        groups: ['LIGHT_VEHICLE'] },
      { model: 'Land Cruiser',   groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: 'Prado',          groups: ['LIGHT_VEHICLE'] },
      { model: 'Hilux',          groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Hiace Van',      groups: ['PASSENGER_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'Coaster Bus',    groups: ['PASSENGER_VEHICLE'] },
      { model: 'Fortuner',       groups: ['LIGHT_VEHICLE'] },
      { model: 'RAV4',           groups: ['LIGHT_VEHICLE'] },
    ],
  },
  {
    make: 'Nissan',
    models: [
      { model: 'Patrol',         groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: 'Navara',         groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Urvan',          groups: ['PASSENGER_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'Altima',         groups: ['LIGHT_VEHICLE'] },
      { model: 'Sunny',          groups: ['LIGHT_VEHICLE'] },
      { model: 'X-Trail',        groups: ['LIGHT_VEHICLE'] },
    ],
  },
  {
    make: 'Ford',
    models: [
      { model: 'F-150',          groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Transit Van',    groups: ['PASSENGER_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'Transit Bus',    groups: ['PASSENGER_VEHICLE'] },
      { model: 'Ranger',         groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Explorer',       groups: ['LIGHT_VEHICLE'] },
      { model: 'Expedition',     groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
    ],
  },
  {
    make: 'Mercedes-Benz',
    models: [
      { model: 'E-Class',        groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: 'S-Class',        groups: ['LUXURY_VEHICLE'] },
      { model: 'GLE',            groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: 'Sprinter Van',   groups: ['PASSENGER_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'Actros',         groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Arocs',          groups: ['COMMERCIAL_VEHICLE', 'CONSTRUCTION_VEHICLE'] },
      { model: 'V-Class',        groups: ['PASSENGER_VEHICLE', 'LUXURY_VEHICLE'] },
    ],
  },
  {
    make: 'BMW',
    models: [
      { model: '5 Series',       groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: '7 Series',       groups: ['LUXURY_VEHICLE'] },
      { model: 'X5',             groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
      { model: 'X7',             groups: ['LIGHT_VEHICLE', 'LUXURY_VEHICLE'] },
    ],
  },
  {
    make: 'Isuzu',
    models: [
      { model: 'D-Max',          groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'ELF Truck',      groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Forward Truck',  groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Giga Truck',     groups: ['COMMERCIAL_VEHICLE'] },
    ],
  },
  {
    make: 'Mitsubishi',
    models: [
      { model: 'L200 Triton',    groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Pajero',         groups: ['LIGHT_VEHICLE'] },
      { model: 'Canter',         groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'Rosa Bus',       groups: ['PASSENGER_VEHICLE'] },
      { model: 'Fuso Truck',     groups: ['COMMERCIAL_VEHICLE'] },
    ],
  },
  {
    make: 'Volvo',
    models: [
      { model: 'FH Truck',       groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'FM Truck',       groups: ['COMMERCIAL_VEHICLE'] },
      { model: 'B8R Bus',        groups: ['PASSENGER_VEHICLE'] },
      { model: 'EC Excavator',   groups: ['CONSTRUCTION_VEHICLE'] },
      { model: 'A-Series Dumper',groups: ['CONSTRUCTION_VEHICLE'] },
    ],
  },
  {
    make: 'Caterpillar',
    models: [
      { model: '320 Excavator',  groups: ['CONSTRUCTION_VEHICLE'] },
      { model: '950 Loader',     groups: ['CONSTRUCTION_VEHICLE'] },
      { model: 'D6 Bulldozer',   groups: ['CONSTRUCTION_VEHICLE'] },
      { model: '740 Dumper',     groups: ['CONSTRUCTION_VEHICLE'] },
      { model: '725 Articulated Truck', groups: ['CONSTRUCTION_VEHICLE'] },
    ],
  },
  {
    make: 'Hyundai',
    models: [
      { model: 'Sonata',         groups: ['LIGHT_VEHICLE'] },
      { model: 'Tucson',         groups: ['LIGHT_VEHICLE'] },
      { model: 'H-1 Van',        groups: ['PASSENGER_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'County Bus',     groups: ['PASSENGER_VEHICLE'] },
    ],
  },
  {
    make: 'Lexus',
    models: [
      { model: 'LX 600',         groups: ['LUXURY_VEHICLE'] },
      { model: 'ES 350',         groups: ['LUXURY_VEHICLE', 'LIGHT_VEHICLE'] },
      { model: 'GX 460',         groups: ['LUXURY_VEHICLE', 'LIGHT_VEHICLE'] },
    ],
  },
  {
    make: 'Range Rover',
    models: [
      { model: 'Defender',       groups: ['LIGHT_VEHICLE', 'COMMERCIAL_VEHICLE'] },
      { model: 'Range Rover',    groups: ['LUXURY_VEHICLE'] },
      { model: 'Discovery',      groups: ['LIGHT_VEHICLE'] },
    ],
  },
];

// Lookup: get vehicle groups for a given make + model
export function getGroupsForModel(make: string, model: string): string[] {
  const makeDef = VEHICLE_MAKES.find(m => m.make === make);
  if (!makeDef) return [];
  const modelDef = makeDef.models.find(m => m.model === model);
  return modelDef?.groups ?? [];
}

// Lookup: get all makes
export function getAllMakes(): string[] {
  return VEHICLE_MAKES.map(m => m.make);
}

// Lookup: get models for a make
export function getModelsForMake(make: string): { model: string; groups: string[] }[] {
  return VEHICLE_MAKES.find(m => m.make === make)?.models ?? [];
}

function getGroupCodesForVehicleType(vehicleType: string): string[] {
  const normalized = String(vehicleType ?? '').trim().toUpperCase();
  if (!normalized) return [];

  const directGroups = VEHICLE_GROUPS
    .filter(group => group.types.includes(normalized))
    .map(group => group.code);
  if (directGroups.length > 0) return directGroups;

  const aliases: Record<string, string[]> = {
    TRUCK: ['COMMERCIAL_VEHICLE'],
    LUXURY: ['LUXURY_VEHICLE'],
    OTHER: [],
  };

  return aliases[normalized] ?? [];
}

// Lookup: get models for a make filtered by selected vehicle type
export function getModelsForMakeAndVehicleType(make: string, vehicleType?: string): { model: string; groups: string[] }[] {
  const models = getModelsForMake(make);
  const groupCodes = getGroupCodesForVehicleType(vehicleType ?? '');
  if (groupCodes.length === 0) return models;

  return models.filter(model => model.groups.some(group => groupCodes.includes(group)));
}

// Lookup: get group label
export function getGroupLabel(code: string): string {
  return VEHICLE_GROUPS.find(g => g.code === code)?.label ?? code;
}

// Lookup: get all vehicle types flat list
export function getAllVehicleTypes(): string[] {
  return VEHICLE_GROUPS.flatMap(g => g.types);
}

// Get types for a group
export function getTypesForGroup(groupCode: string): string[] {
  return VEHICLE_GROUPS.find(g => g.code === groupCode)?.types ?? [];
}
