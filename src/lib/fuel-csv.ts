/**
 * Fuel-card CSV parser for leasing fuel logs.
 *
 * Supports common header formats from UAE fuel-card providers:
 *   - ENOC SmartTAG    (Date, Time, Vehicle Plate, Card No, Litres, Amount, Station, Mileage)
 *   - ADNOC Voyager    (TransactionDate, VehiclePlate, CardNumber, Quantity, TotalAmount, StationName)
 *   - EMARAT FleetCard (Txn Date, Plate, Card #, Volume L, Total AED, Site)
 *
 * Adapter is header-driven — we sniff column headers (case-insensitive,
 * whitespace-tolerant) and map them to our canonical FuelRow shape. If a row
 * is missing required fields it's reported in `errors` and skipped, not
 * failed-loud — finance teams like to see partial successes with a clear
 * list of bad rows to fix.
 */

export interface FuelRow {
  fuelDate: Date;
  licensePlate: string | null;
  fuelCardNo: string | null;
  liters: number;
  costPerLiter: number | null;
  totalCost: number;
  station: string | null;
  mileageAtFuel: number | null;
}

export interface ParseResult {
  rows: FuelRow[];
  errors: { row: number; reason: string }[];
  detectedFormat: 'ENOC' | 'ADNOC' | 'EMARAT' | 'GENERIC' | 'UNKNOWN';
}

/* ── Header alias map — canonical key → list of header variants we accept ── */

const ALIASES: Record<keyof FuelRow | 'date' | 'time' | 'amountWithoutVat', string[]> = {
  fuelDate:        ['date', 'fueldate', 'transactiondate', 'txndate', 'txn_date', 'transaction_date'],
  date:            [],
  time:            ['time', 'txntime', 'transactiontime'],
  licensePlate:    ['vehicleplate', 'plate', 'vehicle_plate', 'license_plate', 'licenseplate', 'platenumber', 'plate_no'],
  fuelCardNo:      ['cardnumber', 'cardno', 'card_no', 'card#', 'card_number'],
  liters:          ['litres', 'liters', 'quantity', 'volumel', 'volume_l', 'volume', 'qty'],
  costPerLiter:    ['priceperlitre', 'pricel', 'price_per_litre', 'rate', 'unitprice', 'unit_price'],
  totalCost:       ['amount', 'totalamount', 'total_aed', 'total', 'totalcost', 'totalcostaed'],
  amountWithoutVat: ['amountexcvat', 'amountexvat', 'subtotal'],
  station:         ['station', 'stationname', 'site', 'site_name', 'location'],
  mileageAtFuel:   ['mileage', 'odometer', 'odo', 'kilometers', 'km'],
};

const FORMAT_FINGERPRINTS: Array<{ format: ParseResult['detectedFormat']; signature: string[] }> = [
  { format: 'ENOC',   signature: ['cardno', 'litres', 'station'] },
  { format: 'ADNOC',  signature: ['transactiondate', 'vehicleplate', 'cardnumber'] },
  { format: 'EMARAT', signature: ['plate', 'volumel'] },
];

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-#./]+/g, '').replace(/[^a-z0-9]/g, '');
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const idx = headers.findIndex(h => normaliseHeader(h) === normaliseHeader(a));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Minimal CSV row parser that handles double-quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur.length === 0) { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseDate(dateStr: string, timeStr?: string): Date | null {
  if (!dateStr) return null;
  const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;

  // ISO first.
  const iso = new Date(combined);
  if (!Number.isNaN(iso.getTime())) return iso;

  // Try DD/MM/YYYY (UAE format) and DD-MM-YYYY.
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\s*(\d{1,2}:\d{2}(:\d{2})?)?\s*([AP]M)?$/i.exec(combined);
  if (m) {
    let [, dd, mm, yyyy, time, , ampm] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    let [hh = '0', mi = '0', se = '0'] = (time ?? '').split(':');
    let h = parseInt(hh, 10);
    if (ampm) {
      if (/PM/i.test(ampm) && h < 12) h += 12;
      if (/AM/i.test(ampm) && h === 12) h = 0;
    }
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10), h, parseInt(mi, 10), parseInt(se, 10));
  }
  return null;
}

function parseNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseFuelCsv(csv: string): ParseResult {
  // Accept BOM + CR/LF tolerantly.
  const cleaned = csv.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: [{ row: 0, reason: 'CSV must contain a header row plus at least one data row' }], detectedFormat: 'UNKNOWN' };
  }

  const headers = parseCsvLine(lines[0]);
  const normalised = headers.map(normaliseHeader);

  // Detect format.
  let detectedFormat: ParseResult['detectedFormat'] = 'GENERIC';
  for (const f of FORMAT_FINGERPRINTS) {
    if (f.signature.every(s => normalised.includes(normaliseHeader(s)))) {
      detectedFormat = f.format;
      break;
    }
  }

  const idx = {
    fuelDate:      findColumnIndex(headers, ALIASES.fuelDate),
    time:          findColumnIndex(headers, ALIASES.time),
    licensePlate:  findColumnIndex(headers, ALIASES.licensePlate),
    fuelCardNo:    findColumnIndex(headers, ALIASES.fuelCardNo),
    liters:        findColumnIndex(headers, ALIASES.liters),
    costPerLiter:  findColumnIndex(headers, ALIASES.costPerLiter),
    totalCost:     findColumnIndex(headers, ALIASES.totalCost),
    station:       findColumnIndex(headers, ALIASES.station),
    mileageAtFuel: findColumnIndex(headers, ALIASES.mileageAtFuel),
  };

  if (idx.fuelDate < 0) {
    return { rows: [], errors: [{ row: 0, reason: 'No date column found. Expected one of: Date, FuelDate, TransactionDate, TxnDate' }], detectedFormat };
  }
  if (idx.liters < 0 || idx.totalCost < 0) {
    return { rows: [], errors: [{ row: 0, reason: 'Litres and Total Amount columns are required' }], detectedFormat };
  }

  const rows: FuelRow[] = [];
  const errors: ParseResult['errors'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const dateStr = cells[idx.fuelDate];
    const timeStr = idx.time >= 0 ? cells[idx.time] : undefined;
    const date = parseDate(dateStr, timeStr);
    if (!date) { errors.push({ row: i + 1, reason: `Unparseable date "${dateStr}"` }); continue; }

    const liters = parseNumber(cells[idx.liters]);
    const totalCost = parseNumber(cells[idx.totalCost]);
    if (!liters || liters <= 0) { errors.push({ row: i + 1, reason: 'Missing or invalid litres' }); continue; }
    if (!totalCost || totalCost < 0) { errors.push({ row: i + 1, reason: 'Missing or invalid total cost' }); continue; }

    const costPerLiter = idx.costPerLiter >= 0 ? parseNumber(cells[idx.costPerLiter]) : null;

    rows.push({
      fuelDate: date,
      licensePlate: idx.licensePlate >= 0 ? (cells[idx.licensePlate] || null) : null,
      fuelCardNo:   idx.fuelCardNo   >= 0 ? (cells[idx.fuelCardNo]   || null) : null,
      liters,
      costPerLiter: costPerLiter ?? (totalCost && liters ? Number((totalCost / liters).toFixed(3)) : null),
      totalCost,
      station:      idx.station >= 0 ? (cells[idx.station] || null) : null,
      mileageAtFuel: idx.mileageAtFuel >= 0 ? parseNumber(cells[idx.mileageAtFuel]) : null,
    });
  }

  return { rows, errors, detectedFormat };
}
