/**
 * UAE RTA-aligned pre-trip vehicle inspection checklist for staff buses.
 * 10 items covering safety-critical systems. The driver must check each
 * before departing; CRITICAL fails block departure (handled in the API).
 */

export interface ChecklistItem {
  key: string;
  label: string;
  category: 'tyres' | 'brakes' | 'lights' | 'safety' | 'docs' | 'fluids' | 'cabin';
  /** A failure on this item blocks DEPART. */
  blocking: boolean;
}

export const PRETRIP_CHECKLIST: ChecklistItem[] = [
  { key: 'tyres_pressure',     label: 'Tyres — pressure and tread depth OK',                category: 'tyres',  blocking: true  },
  { key: 'brakes',             label: 'Brakes — pedal feel and parking brake hold',          category: 'brakes', blocking: true  },
  { key: 'lights_indicators',  label: 'Headlights, brake lights, and indicators all working',category: 'lights', blocking: true  },
  { key: 'mirrors_wipers',     label: 'Mirrors clean + wipers functional',                  category: 'safety', blocking: false },
  { key: 'seat_belts',         label: 'Driver and passenger seat belts in working order',    category: 'safety', blocking: true  },
  { key: 'fire_extinguisher',  label: 'Fire extinguisher present and within service date',   category: 'safety', blocking: true  },
  { key: 'first_aid_kit',      label: 'First-aid kit present and stocked',                  category: 'safety', blocking: false },
  { key: 'fuel_oil',           label: 'Fuel sufficient and oil level OK',                    category: 'fluids', blocking: false },
  { key: 'mulkiya_insurance',  label: 'Vehicle registration (mulkiya) and insurance valid',  category: 'docs',   blocking: true  },
  { key: 'cabin_clean',        label: 'Cabin clean, no loose objects, AC working',           category: 'cabin',  blocking: false },
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

/**
 * Pure: validate a checklist submission. Throws if structurally invalid;
 * returns assessment otherwise. The API uses blockingFailures.length to
 * decide whether DEPART is allowed.
 */
export function assessChecklist(items: ChecklistResultItem[]): ChecklistAssessment {
  const itemMap = new Map(PRETRIP_CHECKLIST.map(i => [i.key, i]));
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
