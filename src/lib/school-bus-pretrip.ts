/**
 * School-bus pre-trip checklist — extends the staff-bus checklist with
 * child-safety items required by UAE RTA passenger transport licensing.
 *
 * Reuses the BusPreTripCheck schema (scheduleId stores the school-bus
 * trip id since the column is a plain UUID without FK to TripSchedule).
 */

export interface SchoolBusChecklistItem {
  key: string;
  label: string;
  category: 'tyres' | 'brakes' | 'lights' | 'safety' | 'docs' | 'fluids' | 'cabin' | 'child';
  blocking: boolean;
}

export const SCHOOL_BUS_PRETRIP_CHECKLIST: SchoolBusChecklistItem[] = [
  // Vehicle integrity
  { key: 'tyres_pressure',     label: 'Tyres — pressure and tread depth OK',                category: 'tyres',  blocking: true  },
  { key: 'brakes',             label: 'Brakes — pedal feel and parking brake hold',          category: 'brakes', blocking: true  },
  { key: 'lights_indicators',  label: 'Headlights, brake lights, indicators, school-bus lamps all working', category: 'lights', blocking: true  },
  { key: 'mirrors_wipers',     label: 'Mirrors clean and adjusted; wipers functional',       category: 'safety', blocking: false },
  { key: 'fuel_oil',           label: 'Fuel sufficient and oil level OK',                    category: 'fluids', blocking: false },
  { key: 'mulkiya_insurance',  label: 'Vehicle registration (mulkiya) and insurance valid',  category: 'docs',   blocking: true  },
  // Child-safety mandatory
  { key: 'all_seat_belts',     label: 'All passenger seat-belts present and functional',     category: 'child',  blocking: true  },
  { key: 'child_restraints',   label: 'Child restraint systems (booster / harness) working', category: 'child',  blocking: true  },
  { key: 'emergency_exit',     label: 'Emergency exit accessible and not blocked',           category: 'safety', blocking: true  },
  { key: 'fire_extinguisher',  label: 'Fire extinguisher present and within service date',   category: 'safety', blocking: true  },
  { key: 'first_aid_kit',      label: 'First-aid kit present and stocked',                  category: 'safety', blocking: true  },
  { key: 'cctv_recording',     label: 'On-board CCTV recording (where fitted)',              category: 'safety', blocking: false },
  { key: 'ac_working',         label: 'Cabin AC working — important in UAE summer',          category: 'cabin',  blocking: true  },
  { key: 'no_loose_objects',   label: 'No loose objects in cabin that could become projectiles', category: 'cabin', blocking: false },
  { key: 'student_list',       label: 'Student manifest printed/digital and on-board',       category: 'docs',   blocking: false },
];

export interface ChecklistResultItem {
  key: string;
  ok: boolean;
  note?: string;
}

export interface ChecklistAssessment {
  overallPass: boolean;
  failCount: number;
  blockingFailures: { key: string; label: string }[];
}

export function assessSchoolBusChecklist(items: ChecklistResultItem[]): ChecklistAssessment {
  const itemMap = new Map(SCHOOL_BUS_PRETRIP_CHECKLIST.map(i => [i.key, i]));
  const blockingFailures: { key: string; label: string }[] = [];
  let failCount = 0;

  for (const r of items) {
    const def = itemMap.get(r.key);
    if (!def) continue;
    if (!r.ok) {
      failCount += 1;
      if (def.blocking) blockingFailures.push({ key: def.key, label: def.label });
    }
  }
  return {
    overallPass: blockingFailures.length === 0,
    failCount,
    blockingFailures,
  };
}
