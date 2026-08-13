/**
 * lib/cba/types.ts — CBA / union rule-set schema (v1).
 *
 * Each CbaRuleSet row stores a JSONB payload matching `CbaRules`. The
 * payload is versioned (`schemaVersion`) so the engine can read older
 * payloads while we add new rule types.
 *
 * The shape below is the "common" CBA schema. Real-world CBAs have
 * dozens of rule categories (split shifts, holiday pay, mileage
 * compensation, call-out premiums, etc.). We start with the categories
 * that drive the Planning Core's runcut and block algorithms; more
 * will land as tenant demand requires.
 */

export const CBA_SCHEMA_VERSION = 1;

/** A single CBA rule (named unit of work-rule logic). */
export interface CbaRule {
  /** Stable id within the rule-set so the UI can reference a specific
   *  rule when editing. UUIDv4 generated at create time. */
  id: string;
  /** Display name — e.g. "Max work hours / day" */
  name: string;
  /** Optional human description / source clause reference */
  description?: string;
  /** Which rule category this row populates. The engine reads the
   *  value field of the matching category below. */
  category: CbaRuleCategory;
  /** Numeric value (hours / minutes / multiplier). Boolean rules
   *  serialise true as 1, false as 0. */
  value: number;
  /** Unit of `value` — surfaces in the UI for clarity. */
  unit: 'HOURS' | 'MINUTES' | 'AED' | 'MULTIPLIER' | 'COUNT' | 'PERCENT';
  /** For DAY_MASK, the 7-char string. For BOOLEAN rules, 1/0. */
  stringValue?: string;
  /** Free-form note shown next to the rule in the UI. */
  note?: string;
  /** If true, the rule is enforced in the runcut / block / roster
   *  engine. If false, the rule is reported in the compliance audit
   *  but not used to break a run. Lets tenants preview a proposed CBA
   *  change without immediately invalidating every plan. */
  enforced: boolean;
}

export type CbaRuleCategory =
  // Daily caps
  | 'MAX_WORK_HOURS_PER_DAY'        // hours, default 8
  | 'MAX_SPREAD_HOURS_PER_DAY'      // hours, default 12
  | 'MAX_DRIVING_HOURS_CONTINUOUS'  // hours, default 4.5
  | 'MIN_BREAK_BETWEEN_TRIPS'       // minutes, default 30
  | 'MIN_DAILY_REST'                // hours, default 11
  | 'MAX_CONSECUTIVE_DAYS'          // count, default 6
  // Weekly caps
  | 'MAX_WORK_HOURS_PER_WEEK'       // hours, default 48
  | 'MAX_OT_HOURS_PER_WEEK'         // hours, default 12
  | 'MIN_WEEKLY_REST_DAYS'          // count, default 1
  // Overtime
  | 'OT_THRESHOLD_HOURS'            // hours, default 8
  | 'OT_RATE'                        // multiplier, default 1.5
  | 'WEEKEND_OT_RATE'                // multiplier, default 2.0
  | 'HOLIDAY_OT_RATE'                // multiplier, default 2.5
  // Pay structure
  | 'HOURLY_RATE'                    // AED, default 25
  | 'MILEAGE_RATE_PER_KM'            // AED, default 0
  | 'NIGHT_SHIFT_PREMIUM_RATE'       // multiplier, default 1.25
  // Days off
  | 'MANDATORY_REST_DAY_MASK'        // 7-char 'Y'/'N' starting Sunday
  | 'WEEKLY_PATTERN'                 // '5/2', '4/3', '6/1', 'CUSTOM'
  | 'CUSTOM_PATTERN_STRING'          // 7-char when WEEKLY_PATTERN='CUSTOM'
  // Shift
  | 'MIN_SHIFT_HOURS'                // hours, default 4
  | 'MAX_SHIFT_HOURS'                // hours, default 12
  | 'MIN_SPLIT_BREAK_HOURS'          // hours, default 2 (split shifts)
  | 'MAX_TRIPS_PER_RUN'              // count, default 12
  | 'MIN_DEADHEAD_BETWEEN_TRIPS'     // minutes, default 15
  | 'REPORT_TIME_MIN'                // minutes, default 15
  | 'WRAP_TIME_MIN'                  // minutes, default 10
  // Compliance flags
  | 'ENFORCED'                       // boolean — see CbaRule.enforced below
  | 'CUSTOM';                        // free-form, surfaces in audit

/** The full rule-set payload stored in cba_rule_sets.rules. */
export interface CbaRules {
  schemaVersion: number;
  /** The full ordered list of rules. The engine looks up rules by
   *  `category` — first match wins, so order is for UI display only. */
  rules: CbaRule[];
  /** Optional metadata for the UI. */
  meta?: {
    /** Country / jurisdiction the CBA was negotiated under */
    jurisdiction?: string;
    /** Effective date of the agreement (ISO date) */
    effectiveFrom?: string;
    /** Expiry date (ISO date) — rules with expiry in the past are
     *  auto-flipped to advisory (enforced=false) by the engine. */
    effectiveTo?: string;
    /** Trade union / counterparty */
    counterparty?: string;
    /** Reference document URL or citation */
    reference?: string;
  };
}

/** Helpers ─────────────────────────────────────────────────────────────── */

export const DEFAULT_CBA_RULES: CbaRules = {
  schemaVersion: CBA_SCHEMA_VERSION,
  rules: [
    { id: 'r-default-max-work',     name: 'Max work hours / day',     category: 'MAX_WORK_HOURS_PER_DAY',       value: 8,    unit: 'HOURS',    enforced: true },
    { id: 'r-default-max-spread',   name: 'Max spread hours / day',   category: 'MAX_SPREAD_HOURS_PER_DAY',     value: 12,   unit: 'HOURS',    enforced: true },
    { id: 'r-default-max-driving',  name: 'Max driving hours continuous', category: 'MAX_DRIVING_HOURS_CONTINUOUS', value: 4.5, unit: 'HOURS',   enforced: true, note: 'Typical EU AETR limit.' },
    { id: 'r-default-min-break',    name: 'Min break between trips',   category: 'MIN_BREAK_BETWEEN_TRIPS',      value: 30,   unit: 'MINUTES',  enforced: true },
    { id: 'r-default-daily-rest',   name: 'Min daily rest',           category: 'MIN_DAILY_REST',               value: 11,   unit: 'HOURS',    enforced: true },
    { id: 'r-default-consec-days',  name: 'Max consecutive days',    category: 'MAX_CONSECUTIVE_DAYS',         value: 6,    unit: 'COUNT',    enforced: true },
    { id: 'r-default-week-cap',     name: 'Max work hours / week',    category: 'MAX_WORK_HOURS_PER_WEEK',      value: 48,   unit: 'HOURS',    enforced: true },
    { id: 'r-default-week-rest',    name: 'Min weekly rest days',     category: 'MIN_WEEKLY_REST_DAYS',         value: 1,    unit: 'COUNT',    enforced: true },
    { id: 'r-default-ot-thresh',    name: 'OT threshold hours',       category: 'OT_THRESHOLD_HOURS',           value: 8,    unit: 'HOURS',    enforced: true },
    { id: 'r-default-ot-rate',      name: 'OT rate (×)',              category: 'OT_RATE',                       value: 1.5,  unit: 'MULTIPLIER', enforced: true },
    { id: 'r-default-hourly',       name: 'Hourly rate (AED)',        category: 'HOURLY_RATE',                   value: 25,   unit: 'AED',      enforced: true },
    { id: 'r-default-pattern',      name: 'Weekly pattern',           category: 'WEEKLY_PATTERN',                value: 0,    unit: 'COUNT',    enforced: true, stringValue: '5/2' },
    { id: 'r-default-min-shift',    name: 'Min shift hours',          category: 'MIN_SHIFT_HOURS',               value: 4,    unit: 'HOURS',    enforced: true },
    { id: 'r-default-max-trips',    name: 'Max trips per run',        category: 'MAX_TRIPS_PER_RUN',             value: 12,   unit: 'COUNT',    enforced: true },
    { id: 'r-default-report',       name: 'Report time (min)',        category: 'REPORT_TIME_MIN',               value: 15,   unit: 'MINUTES',  enforced: true },
    { id: 'r-default-wrap',         name: 'Wrap time (min)',          category: 'WRAP_TIME_MIN',                 value: 10,   unit: 'MINUTES',  enforced: true },
    { id: 'r-default-deadhead',     name: 'Min deadhead between trips', category: 'MIN_DEADHEAD_BETWEEN_TRIPS',    value: 15,   unit: 'MINUTES',  enforced: true },
  ],
  meta: {
    jurisdiction: 'AE',
    counterparty: 'Generic (no specific CBA)',
  },
};

/** Look up a rule value by category. Returns undefined if not set. */
export function getRuleValue(rules: CbaRules, category: CbaRuleCategory): number | undefined {
  const r = rules.rules.find((x) => x.category === category);
  return r?.value;
}

/** Look up a rule's full record. */
export function findRule(rules: CbaRules, category: CbaRuleCategory): CbaRule | undefined {
  return rules.rules.find((x) => x.category === category);
}

/** Build a fresh, empty rule-set payload (used when a tenant creates a new
 *  rule-set — we start from defaults so the UI has rows to display). */
export function freshCbaRules(): CbaRules {
  return {
    schemaVersion: CBA_SCHEMA_VERSION,
    rules: DEFAULT_CBA_RULES.rules.map((r) => ({
      ...r,
      id: `r-${r.category.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,
    })),
    meta: { ...(DEFAULT_CBA_RULES.meta ?? {}) },
  };
}
