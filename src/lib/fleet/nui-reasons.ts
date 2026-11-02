/**
 * src/lib/fleet/nui-reasons.ts
 *
 * Centralized Non-Utilization and Operational reason seeds & types
 * across Transfers, Maintenance, Allocations, Accidents, Legal & Decommission.
 */

export interface NuiReasonSeed {
  code: string;
  name: string;
  reasonType: string;
  description: string;
  impactLevel: string;
  isBillable: boolean;
  isActive: boolean;
}

export const DEFAULT_NUI_REASONS: NuiReasonSeed[] = [
  // TRANSFER
  { code: 'TR-REBAL', name: 'Branch Fleet Rebalancing', reasonType: 'TRANSFER', description: 'Surplus vehicle transferred to meet high customer demand', impactLevel: 'LOW', isBillable: false, isActive: true },
  { code: 'TR-RELOC', name: 'Inter-Depot Relocation', reasonType: 'TRANSFER', description: 'Operational branch re-alignment and territory expansion', impactLevel: 'LOW', isBillable: false, isActive: true },
  { code: 'TR-PROJ',  name: 'Project Dedicated Deployment', reasonType: 'TRANSFER', description: 'Transferred to client project site or dedicated operations hub', impactLevel: 'MEDIUM', isBillable: true, isActive: true },
  { code: 'TR-VIP',   name: 'VIP / Executive Reassignment', reasonType: 'TRANSFER', description: 'Transferred for executive protocol or premium client requirement', impactLevel: 'MEDIUM', isBillable: true, isActive: true },
  { code: 'TR-WORK',  name: 'Central Workshop Transfer', reasonType: 'TRANSFER', description: 'Vehicle relocated to main workshop for major overhaul', impactLevel: 'HIGH', isBillable: false, isActive: true },

  // MAINTENANCE
  { code: 'MNT-PREV', name: 'Preventive Periodic Maintenance', reasonType: 'MAINTENANCE', description: 'Routine 10k/20k/50k km interval mechanical service & oil change', impactLevel: 'MEDIUM', isBillable: false, isActive: true },
  { code: 'MNT-MECH', name: 'Major Mechanical Breakdown', reasonType: 'MAINTENANCE', description: 'Engine, transmission, gearbox or drivetrain failure', impactLevel: 'CRITICAL', isBillable: false, isActive: true },
  { code: 'MNT-ELEC', name: 'Electrical / Telematics Fault', reasonType: 'MAINTENANCE', description: 'Battery, alternator, sensor or GPS telematics hardware issue', impactLevel: 'MEDIUM', isBillable: false, isActive: true },
  { code: 'MNT-TIRE', name: 'Tire Replacement & Alignment', reasonType: 'MAINTENANCE', description: 'Tread wear limit reached or severe puncture repair', impactLevel: 'LOW', isBillable: false, isActive: true },
  { code: 'MNT-BODY', name: 'Body Shop & Paint Restoration', reasonType: 'MAINTENANCE', description: 'Chassis repair, panel beating, denting or re-spray', impactLevel: 'HIGH', isBillable: false, isActive: true },
  { code: 'MNT-RECL', name: 'Manufacturer Recall Campaign', reasonType: 'MAINTENANCE', description: 'Dealer authorized safety recall or warranty replacement', impactLevel: 'HIGH', isBillable: false, isActive: true },

  // ALLOCATION
  { code: 'ALC-DEPT', name: 'Corporate Department Allocation', reasonType: 'ALLOCATION', description: 'Assigned for ongoing operational use by internal department', impactLevel: 'LOW', isBillable: true, isActive: true },
  { code: 'ALC-UNIT', name: 'Operational Unit Assignment', reasonType: 'ALLOCATION', description: 'Deployed to rapid dispatch, patrol or logistics unit', impactLevel: 'LOW', isBillable: true, isActive: true },
  { code: 'ALC-REPL', name: 'Temporary Replacement Vehicle', reasonType: 'ALLOCATION', description: 'Standby replacement while assigned vehicle is under service', impactLevel: 'MEDIUM', isBillable: false, isActive: true },

  // ACCIDENT
  { code: 'ACC-MAJ',  name: 'Major Collision (Police Report)', reasonType: 'ACCIDENT', description: 'Severe accident requiring police investigation & insurance adjuster', impactLevel: 'CRITICAL', isBillable: true, isActive: true },
  { code: 'ACC-MIN',  name: 'Minor Cosmetic Damage', reasonType: 'ACCIDENT', description: 'Superficial scratch or parking dent awaiting claim survey', impactLevel: 'LOW', isBillable: true, isActive: true },
  { code: 'ACC-THD',  name: 'Third-Party Recovery Claim', reasonType: 'ACCIDENT', description: 'Non-fault incident awaiting third-party insurance liability clearance', impactLevel: 'HIGH', isBillable: false, isActive: true },

  // LEGAL & COMPLIANCE
  { code: 'LEG-REG',  name: 'Mulkiya / Registration Renewal', reasonType: 'LEGAL', description: 'Vehicle off-road for annual RTA / Tasjeel technical test', impactLevel: 'MEDIUM', isBillable: false, isActive: true },
  { code: 'LEG-INS',  name: 'Insurance Certificate Endorsement', reasonType: 'LEGAL', description: 'Grounded awaiting comprehensive insurance policy endorsement', impactLevel: 'HIGH', isBillable: false, isActive: true },
  { code: 'LEG-FINE', name: 'Traffic Fine & Impound Clearance', reasonType: 'LEGAL', description: 'Administrative hold pending black points or fine settlement', impactLevel: 'HIGH', isBillable: true, isActive: true },

  // IDLE & STANDBY
  { code: 'IDL-SURP', name: 'Seasonal Off-Peak Surplus', reasonType: 'IDLE', description: 'Parked in fleet depot during seasonal demand contraction', impactLevel: 'LOW', isBillable: false, isActive: true },
  { code: 'IDL-DRIV', name: 'Driver Shortage Standby', reasonType: 'IDLE', description: 'Vehicle operational but pending qualified driver onboarding', impactLevel: 'MEDIUM', isBillable: false, isActive: true },
  { code: 'IDL-STBY', name: 'Operational Reserve Standby', reasonType: 'IDLE', description: 'Designated strategic spare for flight/route contingency', impactLevel: 'LOW', isBillable: false, isActive: true },

  // DECOMMISSION
  { code: 'DEC-SALV', name: 'Total Loss / Salvage Disposal', reasonType: 'DECOMMISSION', description: 'Constructive total loss designated for salvage auction', impactLevel: 'CRITICAL', isBillable: false, isActive: true },
  { code: 'DEC-AUCT', name: 'Auction Fleet Replacement', reasonType: 'DECOMMISSION', description: 'Scheduled retirement at vehicle age/mileage threshold for sale', impactLevel: 'MEDIUM', isBillable: false, isActive: true },
];
