export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { extractPdfText } from '@/lib/fleet/vehicle-autofill';
import * as XLSX from 'xlsx';

export interface ExtractedManifestContainer {
  containerNumber: string;
  size: '20FT' | '40FT' | '40HC' | '45HC';
  containerType: 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK';
  sealNumber: string;
  weightKg: number;
  dischargeDate: string;
  deliveryDate: string;
  deliveryTime: string;
  doExpiryDate: string;
  doExpiryTime: string;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
  isoCheckDigitValid?: boolean;
}

export interface ExtractedManifestResult {
  blOrDoNumber: string;
  shippingLine: string;
  vesselVoyage: string;
  customerName: string;
  terminalName: string;
  warehouseName: string;
  shipmentType: 'IMPORT' | 'EXPORT';
  notes: string;
  containers: ExtractedManifestContainer[];
  provider: 'xlsx-parser' | 'gemini-vision' | 'openai-vision' | 'pdf-smart-parser';
  fileName: string;
  confidencePct: number;
}

/**
 * ISO 6346 letter-to-number mapping (multiples of 11 are skipped per standard:
 * A=10, B=12..K=21, L=23..U=32, V=34..Z=38).
 */
const ISO_6346_CHAR_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function computeIso6346CheckDigit(prefix10: string): number | null {
  if (!/^[A-Z]{4}\d{6}$/.test(prefix10)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = prefix10[i];
    const val = i < 4 ? ISO_6346_CHAR_VALUES[ch] : Number(ch);
    if (val === undefined || isNaN(val)) return null;
    sum += val * Math.pow(2, i);
  }
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}

/**
 * Cleans and normalizes a container number, repairing positional OCR confusions
 * (e.g. '0' vs 'O', '1' vs 'I', '5' vs 'S', '8' vs 'B', '2' vs 'Z', '6' vs 'G')
 * between the 4-letter owner/equipment prefix and the 7-digit serial + check digit.
 */
export function cleanContainerNumber(raw: unknown): { containerNumber: string; isoValid: boolean } {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return { containerNumber: '', isoValid: false };

  const digitToLetter: Record<string, string> = {
    '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B',
  };
  const letterToDigit: Record<string, string> = {
    O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8',
  };

  // Scan any 11-character window for a candidate ISO 6346 container
  for (let i = 0; i <= Math.max(0, s.length - 10); i++) {
    const chunk = s.slice(i, i + 11);
    if (chunk.length >= 10) {
      const p4 = chunk
        .slice(0, 4)
        .split('')
        .map((c) => digitToLetter[c] ?? c)
        .join('');
      const dRest = chunk
        .slice(4)
        .split('')
        .map((c) => letterToDigit[c] ?? c)
        .join('');
      if (/^[A-Z]{3}[UJZ]$/.test(p4) && /^\d{6,7}$/.test(dRest)) {
        const full = `${p4}${dRest}`;
        if (full.length === 11) {
          const expected = computeIso6346CheckDigit(full.slice(0, 10));
          const actual = Number(full[10]);
          return { containerNumber: full, isoValid: expected === actual };
        }
        return { containerNumber: full, isoValid: false };
      }
    }
  }

  const directIso = s.match(/[A-Z]{3}[UJZ]\d{6,7}/);
  if (directIso) {
    const full = directIso[0];
    const expected = full.length === 11 ? computeIso6346CheckDigit(full.slice(0, 10)) : null;
    return {
      containerNumber: full,
      isoValid: expected !== null && expected === Number(full[10]),
    };
  }

  return { containerNumber: s, isoValid: false };
}

function normalizeSize(raw: unknown): '20FT' | '40FT' | '40HC' | '45HC' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '40HC';
  // ISO 6346 size/type codes: 22G1 -> 20FT, 42G1 -> 40FT, 45G1/45R1 -> 40HC, L5G1/95G1 -> 45HC
  if (s.includes('45FT') || s.includes('45HC') || s.includes('45 HQ') || s.startsWith('L5') || s.startsWith('95')) {
    return '45HC';
  }
  if (s.includes('20') || s.startsWith('22') || s.startsWith('20G') || s.startsWith('20R')) {
    return '20FT';
  }
  if (s.includes('HC') || s.includes('HQ') || s.includes('HIGH') || s.startsWith('45G') || s.startsWith('45R')) {
    return '40HC';
  }
  if (s.includes('40FT') || s.includes('40 ST') || s.includes('40STD') || s.startsWith('42') || s.startsWith('40G')) {
    return '40FT';
  }
  if (s.includes('40')) return '40HC';
  return '40HC';
}

function normalizeType(raw: unknown): 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.includes('REEF') || s.includes('RF') || s.includes('COLD') || s.includes('CHILL') || /^[24][25]R/.test(s)) {
    return 'REEFER';
  }
  if (s.includes('OPEN') || s.includes('OT') || /^[24][25]U/.test(s)) {
    return 'OPEN_TOP';
  }
  if (s.includes('FLAT') || s.includes('FR') || /^[24][25]P/.test(s)) {
    return 'FLAT_RACK';
  }
  return 'DRY';
}

function normalizeBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1' || s === 'REQUIRED' || s === 'CHECKED';
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 2020 || y > 2036 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeDate(raw: unknown): string {
  if (!raw) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (!str || str.toUpperCase() === 'NULL' || str.toUpperCase() === 'N/A') return '';

  // YYYY-MM-DD
  const isoMatch = str.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (UAE/GCC convention is Day-Month-Year)
  const dmyMatch = str.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dmyMatch) {
    const dayNum = Number(dmyMatch[1]);
    const monNum = Number(dmyMatch[2]);
    let yearNum = Number(dmyMatch[3]);
    if (yearNum < 100) yearNum += 2000;
    if (isValidCalendarDate(yearNum, monNum, dayNum)) {
      return `${yearNum}-${String(monNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }
  }

  // DD MMM YYYY or DD-MMM-YY (e.g. 12 Nov 2026 or 12-NOV-26)
  const months: Record<string, number> = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  };
  const namedMatch = str.toUpperCase().match(/\b(\d{1,2})[\s/-]+([A-Z]{3})[A-Z]*[\s/,-]+(\d{2,4})\b/);
  if (namedMatch && months[namedMatch[2]]) {
    const dayNum = Number(namedMatch[1]);
    const monNum = months[namedMatch[2]];
    let yearNum = Number(namedMatch[3]);
    if (yearNum < 100) yearNum += 2000;
    if (isValidCalendarDate(yearNum, monNum, dayNum)) {
      return `${yearNum}-${String(monNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }
  }

  return '';
}

function normalizeTime(raw: unknown): string {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str || str.toUpperCase() === 'NULL' || str.toUpperCase() === 'N/A') return '';
  const match = str.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!match) return '';
  let hours = Number(match[1]);
  const mins = match[2];
  const ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours >= 0 && hours <= 23) {
    return `${String(hours).padStart(2, '0')}:${mins}`;
  }
  return '';
}

function cleanJsonResponse(raw: string): Record<string, unknown> | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/, '');
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseSpreadsheetBuffer(buffer: Buffer, fileName: string): ExtractedManifestResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;

  if (!ws) {
    throw new Error('Spreadsheet contains no readable worksheets.');
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const containers: ExtractedManifestContainer[] = [];
  let blOrDoNumber = '';
  let shippingLine = '';
  let customerName = '';
  let terminalName = '';
  let warehouseName = '';
  let notes = '';

  const findVal = (row: Record<string, unknown>, aliases: string[]): unknown => {
    const keys = Object.keys(row);
    for (const k of keys) {
      const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliases.some((a) => normKey === a || normKey.includes(a))) {
        const val = row[k];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
    }
    return '';
  };

  for (const row of rows) {
    const rawCntr = findVal(row, [
      'containernumber',
      'containerno',
      'container',
      'cntrno',
      'cntr',
      'unitno',
      'equipmentno',
      'boxno',
    ]);
    const { containerNumber, isoValid } = cleanContainerNumber(rawCntr);
    if (!containerNumber || containerNumber.length < 4) continue;

    if (!blOrDoNumber) {
      blOrDoNumber = String(findVal(row, ['donumber', 'dono', 'deliveryorder', 'blnumber', 'blno', 'billof', 'bookingno', 'booking']) || '').trim();
    }
    if (!shippingLine) {
      shippingLine = String(findVal(row, ['shippingline', 'carrier', 'line', 'vessel']) || '').trim();
    }
    if (!customerName) {
      customerName = String(findVal(row, ['consignor', 'customer', 'shipper', 'client', 'importer']) || '').trim();
    }
    if (!terminalName) {
      terminalName = String(findVal(row, ['terminal', 'port', 'originterminal', 'pickup']) || '').trim();
    }
    if (!warehouseName) {
      warehouseName = String(findVal(row, ['consignee', 'warehouse', 'destination', 'deliverylocation', 'facility']) || '').trim();
    }
    if (!notes) {
      notes = String(findVal(row, ['notes', 'remarks', 'instructions', 'specialinstructions']) || '').trim();
    }

    const sizeRaw = findVal(row, ['size', 'isosize', 'cntrsize', 'containersize', 'length']);
    const typeRaw = findVal(row, ['type', 'containertype', 'cargotype', 'equipmenttype', 'cntrtype']);
    const sealRaw = findVal(row, ['sealnumber', 'sealno', 'seal', 'linerseal', 'boltseal']);
    const weightRaw = findVal(row, ['weightkg', 'grossweight', 'weight', 'wt', 'cargoweight', 'vgm']);
    const delivDateRaw = findVal(row, ['deliverydate', 'dischargedate', 'targetdate', 'arrivaldate', 'eta']);
    const delivTimeRaw = findVal(row, ['deliverytime', 'targettime']);
    const doExpDateRaw = findVal(row, ['doexpirydate', 'doexpiry', 'expirydate', 'cutoffdate', 'demurragedate', 'dovalidity']);
    const doExpTimeRaw = findVal(row, ['doexpirytime', 'cutofftime', 'expirytime']);

    const customsRaw = findVal(row, ['dubaicustoms', 'customsinspection', 'customs']);
    const dmRaw = findVal(row, ['municipality', 'dminspection', 'dm']);
    const cpipRaw = findVal(row, ['cpipinspection', 'cpip']);
    const mercRaw = findVal(row, ['mercinspection', 'merc', 'fumigation']);
    const boxcareRaw = findVal(row, ['boxcareinspection', 'boxcare', 'sealaudit']);

    const weightNum = Number(String(weightRaw ?? '').replace(/[^0-9.]/g, '')) || 0;
    const normalizedDelivDate = normalizeDate(delivDateRaw);

    containers.push({
      containerNumber,
      size: normalizeSize(sizeRaw || typeRaw),
      containerType: normalizeType(typeRaw || sizeRaw),
      sealNumber: String(sealRaw ?? '').trim().toUpperCase(),
      weightKg: weightNum,
      dischargeDate: normalizedDelivDate,
      deliveryDate: normalizedDelivDate,
      deliveryTime: normalizeTime(delivTimeRaw),
      doExpiryDate: normalizeDate(doExpDateRaw),
      doExpiryTime: normalizeTime(doExpTimeRaw),
      customsInspection: normalizeBoolean(customsRaw),
      municipalityInspection: normalizeBoolean(dmRaw),
      cpipInspection: normalizeBoolean(cpipRaw),
      mercInspection: normalizeBoolean(mercRaw),
      boxcareInspection: normalizeBoolean(boxcareRaw),
      isoCheckDigitValid: isoValid,
    });
  }

  // Fallback: if spreadsheet had no standard column headers, scan cells for ISO 6346 container numbers
  if (containers.length === 0) {
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    const seen = new Set<string>();
    for (const rowArr of rawMatrix) {
      if (!Array.isArray(rowArr)) continue;
      const rowStr = rowArr.map((c) => String(c ?? '')).join(' ');
      const matches = rowStr.toUpperCase().match(/\b[A-Z]{3}[UJZ]\s*-?\s*\d{6}\s*-?\s*\d\b/g) || [];
      for (const m of matches) {
        const { containerNumber, isoValid } = cleanContainerNumber(m);
        if (containerNumber && !seen.has(containerNumber)) {
          seen.add(containerNumber);
          containers.push({
            containerNumber,
            size: normalizeSize(rowStr),
            containerType: normalizeType(rowStr),
            sealNumber: '',
            weightKg: 0,
            dischargeDate: '',
            deliveryDate: '',
            deliveryTime: '',
            doExpiryDate: '',
            doExpiryTime: '',
            customsInspection: false,
            municipalityInspection: false,
            cpipInspection: false,
            mercInspection: false,
            boxcareInspection: false,
            isoCheckDigitValid: isoValid,
          });
        }
      }
    }
  }

  return {
    blOrDoNumber,
    shippingLine,
    vesselVoyage: '',
    customerName,
    terminalName,
    warehouseName,
    shipmentType: 'IMPORT',
    notes: notes || (blOrDoNumber ? `Imported from ${fileName} (Ref: ${blOrDoNumber})` : ''),
    containers,
    provider: 'xlsx-parser',
    fileName,
    confidencePct: 100,
  };
}

/**
 * Strict, label-grounded text parser for digital text — never guesses shipping lines from
 * common English words (like "ONE"), never guesses weights without an explicit KG/MT unit,
 * and never assigns dates without an explicit date label.
 */
function parseRawTextFallback(text: string, fileName: string): ExtractedManifestResult {
  const upper = text.toUpperCase();
  const seen = new Set<string>();
  const containers: ExtractedManifestContainer[] = [];

  // 1. Extract DO / BL reference only when explicitly labeled
  const doMatch =
    text.match(/\b(?:DELIVERY\s*ORDER\s*(?:NO|NUMBER|#)?|D\.?O\.?\s*(?:NO|NUMBER|#)|B\/L\s*(?:NO|NUMBER|#)|BILL\s*OF\s*LADING\s*(?:NO|NUMBER|#)?|BOOKING\s*(?:NO|NUMBER|REF))[\s#:.-]+([A-Z0-9/-]{5,25})\b/i);
  const blOrDoNumber = doMatch?.[1]?.trim() || '';

  // 2. Shipping line detection — word-boundary safe so "ONE" in normal English text never misfires
  let shippingLine = '';
  const carrierPatterns: Array<[RegExp, string]> = [
    [/\bMAERSK(?:\s+LINE)?\b/i, 'Maersk'],
    [/\b(?:MSC|MEDITERRANEAN\s+SHIPPING)\b/i, 'MSC'],
    [/\bCMA\s*CGM\b/i, 'CMA CGM'],
    [/\bHAPAG[\s-]*LLOYD\b/i, 'Hapag-Lloyd'],
    [/\bCOSCO(?:\s+SHIPPING)?\b/i, 'COSCO'],
    [/\bEVERGREEN(?:\s+LINE)?\b/i, 'Evergreen'],
    [/\b(?:OCEAN\s+NETWORK\s+EXPRESS|ONE\s+LINE)\b/i, 'ONE'],
    [/\bOOCL\b/i, 'OOCL'],
    [/\b(?:HMM|HYUNDAI\s+MERCHANT)\b/i, 'HMM'],
    [/\bYANG\s+MING\b/i, 'Yang Ming'],
    [/\b(?:PACIFIC\s+INTERNATIONAL|PIL\s+LINE)\b/i, 'PIL'],
    [/\bZIM(?:\s+INTEGRATED|\s+LINE)\b/i, 'ZIM'],
  ];
  for (const [regex, label] of carrierPatterns) {
    if (regex.test(text)) {
      shippingLine = label;
      break;
    }
  }

  // 3. Terminal detection — require explicit port/terminal names
  let terminalName = '';
  if (/\b(?:KHALIFA\s+PORT|KPCT|ADT\s+KHALIFA)\b/i.test(text)) {
    terminalName = 'Khalifa Port';
  } else if (/\b(?:JEBEL\s+ALI[\s-]*TERMINAL\s*3|DPW[\s-]*JA[\s-]*T3|TERMINAL\s*3\s*JEBEL\s*ALI)\b/i.test(text)) {
    terminalName = 'Jebel Ali Port - Terminal 3';
  } else if (/\b(?:JEBEL\s+ALI[\s-]*TERMINAL\s*2|DPW[\s-]*JA[\s-]*T2|TERMINAL\s*2\s*JEBEL\s*ALI)\b/i.test(text)) {
    terminalName = 'Jebel Ali Port - Terminal 2';
  } else if (/\b(?:JEBEL\s+ALI|DP\s*WORLD\s*UAE|DPW[\s-]*JA[\s-]*T1)\b/i.test(text)) {
    terminalName = 'Jebel Ali Port - Terminal 1';
  }

  // 4. Customer / Consignee detection when labeled
  const custMatch = text.match(/(?:Consignor|Importer|Customer\s*Name|Deliver\s*To\s*Party|Notify\s*Party)\s*[:.-]\s*([^\r\n]{3,60})/i);
  const customerName = custMatch?.[1]?.trim() || '';

  const whMatch = text.match(/(?:Consignee|Delivery\s*Place|Final\s*Destination|Warehouse)\s*[:.-]\s*([^\r\n]{3,60})/i);
  const warehouseName = whMatch?.[1]?.trim() || '';

  // 5. Labeled Dates ONLY (no blind date sorting)
  const dischMatch = text.match(/(?:Discharge\s*Date|Arrival\s*Date|ETA|Vessel\s*Arrival|Delivery\s*Date)[\s:.-]*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/,-]+\d{2,4})/i);
  const dischargeDate = dischMatch ? normalizeDate(dischMatch[1]) : '';

  const expMatch = text.match(/(?:D\.?O\.?\s*Expiry|Expiry\s*Date|Valid\s*Until|Validity\s*Date|Free\s*Time\s*Expiry|Demurrage\s*Start)[\s:.-]*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/,-]+\d{2,4})/i);
  const doExpiryDate = expMatch ? normalizeDate(expMatch[1]) : '';

  // 6. Explicitly labeled seals & weights (unit KG/KGS/MT is mandatory)
  const sealMatches = Array.from(
    text.matchAll(/\b(?:SEAL|BOLT\s*SEAL)(?:\s*(?:NO|NUMBER|#))?[\s:.-]+([A-Z0-9-]{5,15})\b/gi),
  ).map((m) => m[1].toUpperCase());
  const weightMatches = Array.from(
    text.matchAll(/\b(\d{3,5}(?:,\d{3})?(?:\.\d+)?)\s*(?:KG|KGS)\b/gi),
  ).map((m) => Number(m[1].replace(/,/g, '')));

  // 7. Extract ISO 6346 container numbers
  const isoRegex = /\b([A-Z]{3}[UJZ])\s*-?\s*(\d{6})\s*-?\s*(\d)\b/gi;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = isoRegex.exec(text)) !== null) {
    const rawCandidate = `${match[1]}${match[2]}${match[3]}`.toUpperCase();
    const { containerNumber: fullCntr, isoValid } = cleanContainerNumber(rawCandidate);
    if (!fullCntr || seen.has(fullCntr)) continue;
    seen.add(fullCntr);

    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + 160);
    const snippet = text.slice(start, end);

    // Require explicit KG/KGS unit on weight so years/booking numbers are never misread as weight
    const snippetWeight = snippet.match(/\b(\d{3,5}(?:,\d{3})?(?:\.\d+)?)\s*(?:KG|KGS)\b/i);
    const snippetSeal = snippet.match(/\b(?:SEAL|SL)[\s#:.-]+([A-Z0-9-]{5,15})\b/i);

    containers.push({
      containerNumber: fullCntr,
      size: normalizeSize(snippet),
      containerType: normalizeType(snippet),
      sealNumber: snippetSeal?.[1]?.toUpperCase() || sealMatches[idx] || '',
      weightKg: snippetWeight ? Number(snippetWeight[1].replace(/,/g, '')) : (weightMatches[idx] || 0),
      dischargeDate,
      deliveryDate: dischargeDate,
      deliveryTime: '',
      doExpiryDate,
      doExpiryTime: '',
      customsInspection: /\bCUSTOMS\s+INSPECTION\b/i.test(upper),
      municipalityInspection: /\b(?:DUBAI\s+MUNICIPALITY|DM\s+INSPECTION|FOOD\s+CONTROL)\b/i.test(upper),
      cpipInspection: /\bCPIP\b/i.test(upper),
      mercInspection: /\b(?:FUMIGATION|MERC\s+INSPECTION)\b/i.test(upper),
      boxcareInspection: /\bBOXCARE\b/i.test(upper),
      isoCheckDigitValid: isoValid,
    });
    idx++;
  }

  return {
    blOrDoNumber,
    shippingLine,
    vesselVoyage: '',
    customerName,
    terminalName,
    warehouseName,
    shipmentType: /\bEXPORT\b/i.test(upper) ? 'EXPORT' : 'IMPORT',
    notes: [
      blOrDoNumber ? `DO/BL: ${blOrDoNumber}` : '',
      shippingLine ? `Line: ${shippingLine}` : '',
    ].filter(Boolean).join(' • '),
    containers,
    provider: 'pdf-smart-parser',
    fileName,
    confidencePct: containers.length > 0 ? 92 : 0,
  };
}

/**
 * Gemini Structured Output Schema (`responseSchema`) — enforces exact types and enums
 * without putting any dummy example strings in the prompt.
 */
const GEMINI_MANIFEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    blOrDoNumber: { type: 'STRING', description: 'Exact Delivery Order (DO) or Bill of Lading (B/L) or Booking number printed on the document, or empty string if not present.' },
    shippingLine: { type: 'STRING', description: 'Shipping line / carrier name explicitly printed on the document, or empty string if not present.' },
    vesselVoyage: { type: 'STRING', description: 'Vessel name and voyage number if printed, or empty string.' },
    customerName: { type: 'STRING', description: 'Importer / Customer / Consignor / Deliver-To company name printed on the document, or empty string.' },
    terminalName: { type: 'STRING', description: 'Port terminal / pickup facility printed on the document, or empty string.' },
    warehouseName: { type: 'STRING', description: 'Final delivery place / consignee warehouse if printed, or empty string.' },
    shipmentType: { type: 'STRING', enum: ['IMPORT', 'EXPORT'] },
    notes: { type: 'STRING', description: 'Verbatim special instructions or remarks printed on the document, or empty string.' },
    confidencePct: { type: 'NUMBER' },
    containers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          containerNumber: { type: 'STRING', description: '11-character ISO 6346 container number (4 letters + 7 digits) exactly as printed.' },
          size: { type: 'STRING', enum: ['20FT', '40FT', '40HC', '45HC'] },
          containerType: { type: 'STRING', enum: ['DRY', 'REEFER', 'OPEN_TOP', 'FLAT_RACK'] },
          sealNumber: { type: 'STRING', description: 'Seal number explicitly printed for this container, or empty string.' },
          weightKg: { type: 'NUMBER', description: 'Gross or cargo weight in KG for this container, or 0 if not printed.' },
          dischargeDate: { type: 'STRING', description: 'Discharge / arrival date in YYYY-MM-DD format if printed, or empty string.' },
          deliveryDate: { type: 'STRING', description: 'Target delivery date in YYYY-MM-DD format if printed, or empty string.' },
          deliveryTime: { type: 'STRING', description: 'Delivery time in HH:MM (24h) format if printed, or empty string.' },
          doExpiryDate: { type: 'STRING', description: 'Delivery Order (DO) validity / expiry / demurrage start date in YYYY-MM-DD format if printed, or empty string.' },
          doExpiryTime: { type: 'STRING', description: 'DO cutoff time in HH:MM (24h) format if printed, or empty string.' },
          customsInspection: { type: 'BOOLEAN' },
          municipalityInspection: { type: 'BOOLEAN' },
          cpipInspection: { type: 'BOOLEAN' },
          mercInspection: { type: 'BOOLEAN' },
          boxcareInspection: { type: 'BOOLEAN' },
        },
        required: [
          'containerNumber',
          'size',
          'containerType',
          'sealNumber',
          'weightKg',
          'dischargeDate',
          'deliveryDate',
          'deliveryTime',
          'doExpiryDate',
          'doExpiryTime',
          'customsInspection',
          'municipalityInspection',
          'cpipInspection',
          'mercInspection',
          'boxcareInspection',
        ],
      },
    },
  },
  required: [
    'blOrDoNumber',
    'shippingLine',
    'vesselVoyage',
    'customerName',
    'terminalName',
    'warehouseName',
    'shipmentType',
    'notes',
    'confidencePct',
    'containers',
  ],
};

export async function POST(req: NextRequest) {
  const tenantAuth = await requireAuthorizedTenant(req);
  if ('response' in tenantAuth) return tenantAuth.response;

  try {
    const contentType = req.headers.get('content-type') || '';
    let fileBuffer: Buffer | null = null;
    let fileName = 'document';
    let mimeType = 'application/octet-stream';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ error: 'No file provided in upload.' }, { status: 400 });
      }
      fileName = file.name || 'uploaded-manifest';
      mimeType = file.type || 'application/octet-stream';
      const ab = await file.arrayBuffer();
      fileBuffer = Buffer.from(ab);
    } else {
      const body = await req.json().catch(() => ({}));
      fileName = String(body.fileName || 'uploaded-document');
      mimeType = String(body.mimeType || 'application/octet-stream');
      const dataUri = String(body.fileDataUri || '');
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/i);
      if (match) {
        mimeType = match[1];
        fileBuffer = Buffer.from(match[2], 'base64');
      } else if (body.rawText) {
        const parsed = parseRawTextFallback(String(body.rawText), fileName);
        return NextResponse.json({ ok: true, manifest: parsed });
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty.' }, { status: 400 });
    }

    const lowerName = fileName.toLowerCase();

    // 1. Excel / CSV Spreadsheet Path (.xlsx, .xls, .csv)
    if (
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv') ||
      mimeType.includes('spreadsheet') ||
      mimeType.includes('excel') ||
      mimeType.includes('csv')
    ) {
      const result = parseSpreadsheetBuffer(fileBuffer, fileName);
      if (result.containers.length === 0) {
        return NextResponse.json(
          { error: 'No valid container rows were found in the spreadsheet. Ensure there is a "Container Number" column or ISO 6346 container IDs.' },
          { status: 422 },
        );
      }
      return NextResponse.json({ ok: true, manifest: result });
    }

    // 2. Clean Digital Text Extraction if PDF (NEVER use raw binary latin1 dump)
    let extractedPdfText = '';
    const isPdf = lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
    if (isPdf) {
      try {
        const pdfParseMod = await import('pdf-parse');
        const pdfParseFn = (pdfParseMod as unknown as { default?: (buf: Buffer) => Promise<{ text?: string }> }).default
          || (pdfParseMod as unknown as (buf: Buffer) => Promise<{ text?: string }>);
        if (typeof pdfParseFn === 'function') {
          const parsedPdf = await pdfParseFn(fileBuffer);
          extractedPdfText = (parsedPdf?.text || '').trim();
        }
      } catch {
        // Fallback to CMap stream decoder (never raw latin1 binary bytes)
        extractedPdfText = extractPdfText(fileBuffer).trim();
      }
      if (!extractedPdfText) {
        extractedPdfText = extractPdfText(fileBuffer).trim();
      }
    }

    // 3. AI Vision / Document OCR (Google Gemini 2.0 Flash / OpenAI GPT-4o Vision)
    const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
    const openAiKey =
      process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('dev-')
        ? process.env.OPENAI_API_KEY
        : '';

    const strictPrompt = [
      'You are a zero-hallucination UAE Port Drayage, Delivery Order (DO), Bill of Lading (B/L), and Container Manifest OCR engine.',
      'Carefully read the attached document and extract ONLY the values explicitly printed on the document.',
      '',
      'STRICT ANTI-HALLUCINATION RULES:',
      '1. NEVER invent, guess, or fabricate container numbers, seal numbers, weights, dates, customer names, or terminal names.',
      '2. Every field not explicitly visible on the document MUST be returned as "" (empty string), 0 (for weightKg), or false (for inspections).',
      '3. Container numbers follow ISO 6346 (4 letters ending in U, J, or Z followed by 7 digits). Read every character carefully (do not confuse O with 0, I with 1, S with 5, or B with 8).',
      '4. Convert dates to YYYY-MM-DD (UAE date convention on documents is DD/MM/YYYY or DD-MMM-YYYY).',
      '   - "dischargeDate": Vessel Discharge Date / Arrival Date / ETA if printed.',
      '   - "deliveryDate": Requested Delivery Date if printed (otherwise same as dischargeDate if printed, else "").',
      '   - "doExpiryDate": Delivery Order (DO) Validity / Expiry Date / Free-Time Expiry Date if printed.',
      '5. Map ISO size/type codes accurately:',
      '   - 22G0, 22G1, 20\', 20FT -> size: "20FT"',
      '   - 42G0, 42G1, 40\' STD, 40FT -> size: "40FT"',
      '   - 45G0, 45G1, 45R1, 40\' HC, 40\' HQ, 40HC -> size: "40HC"',
      '   - L5G1, 95G1, 45\' HC, 45HC -> size: "45HC"',
      '   - Reefer / Refrigerated / 22R1 / 45R1 -> containerType: "REEFER"',
      '   - Open Top / 22U1 / 42U1 -> containerType: "OPEN_TOP"',
      '   - Flat Rack / 22P1 / 42P1 -> containerType: "FLAT_RACK"',
      '   - All standard general-purpose dry containers -> containerType: "DRY"',
      '6. If weight is printed in Metric Tons (MT), multiply by 1000 to convert to KG. If tare + net weight are shown, use Gross Weight in KG.',
    ].join('\n');

    const mapParsedContainers = (rawContainers: Array<Record<string, unknown>>): ExtractedManifestContainer[] =>
      rawContainers
        .map((c) => {
          const { containerNumber, isoValid } = cleanContainerNumber(c.containerNumber);
          const dischDate = normalizeDate(c.dischargeDate);
          const delivDate = normalizeDate(c.deliveryDate) || dischDate;
          return {
            containerNumber,
            size: normalizeSize(c.size),
            containerType: normalizeType(c.containerType),
            sealNumber: String(c.sealNumber || '').trim().toUpperCase(),
            weightKg: Number(c.weightKg) || 0,
            dischargeDate: dischDate || delivDate,
            deliveryDate: delivDate,
            deliveryTime: normalizeTime(c.deliveryTime),
            doExpiryDate: normalizeDate(c.doExpiryDate),
            doExpiryTime: normalizeTime(c.doExpiryTime),
            customsInspection: Boolean(c.customsInspection),
            municipalityInspection: Boolean(c.municipalityInspection),
            cpipInspection: Boolean(c.cpipInspection),
            mercInspection: Boolean(c.mercInspection),
            boxcareInspection: Boolean(c.boxcareInspection),
            isoCheckDigitValid: isoValid,
          };
        })
        .filter((c) => c.containerNumber.length >= 4);

    if (geminiKey) {
      const effectiveMime = isPdf
        ? 'application/pdf'
        : mimeType.startsWith('image/')
          ? mimeType
          : 'image/jpeg';

      for (const modelName of ['gemini-2.0-flash', 'gemini-flash-latest']) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
          const parts: Array<Record<string, unknown>> = [{ text: strictPrompt }];
          if (extractedPdfText.length > 20) {
            parts.push({ text: `\nVerbatim Digital Text Layer from PDF:\n${extractedPdfText.slice(0, 30000)}` });
          }
          parts.push({
            inline_data: {
              mime_type: effectiveMime,
              data: fileBuffer.toString('base64'),
            },
          });

          const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 4096,
                responseMimeType: 'application/json',
                responseSchema: GEMINI_MANIFEST_SCHEMA,
              },
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (geminiRes.ok) {
            const data = (await geminiRes.json()) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            const parsed = cleanJsonResponse(text);
            if (parsed && Array.isArray(parsed.containers) && parsed.containers.length > 0) {
              const containers = mapParsedContainers(parsed.containers as Array<Record<string, unknown>>);
              if (containers.length > 0) {
                const result: ExtractedManifestResult = {
                  blOrDoNumber: String(parsed.blOrDoNumber || '').trim(),
                  shippingLine: String(parsed.shippingLine || '').trim(),
                  vesselVoyage: String(parsed.vesselVoyage || '').trim(),
                  customerName: String(parsed.customerName || '').trim(),
                  terminalName: String(parsed.terminalName || '').trim(),
                  warehouseName: String(parsed.warehouseName || '').trim(),
                  shipmentType: String(parsed.shipmentType || '').toUpperCase() === 'EXPORT' ? 'EXPORT' : 'IMPORT',
                  notes: String(parsed.notes || '').trim(),
                  containers,
                  provider: 'gemini-vision',
                  fileName,
                  confidencePct: Number(parsed.confidencePct || 99),
                };
                return NextResponse.json({ ok: true, manifest: result });
              }
            }
          }
        } catch (err) {
          console.warn(`[ocr-manifest] Gemini (${modelName}) extraction error:`, err);
        }
      }
    }

    // 4. OpenAI High-Accuracy Vision (supports both PDFs via file part and images via image_url)
    if (openAiKey) {
      try {
        const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: strictPrompt }];
        if (extractedPdfText.length > 20) {
          userContent.push({
            type: 'text',
            text: `\nVerbatim Digital Text Layer from PDF:\n${extractedPdfText.slice(0, 25000)}`,
          });
        }
        if (isPdf) {
          userContent.push({
            type: 'file',
            file: {
              filename: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
              file_data: `data:application/pdf;base64,${fileBuffer.toString('base64')}`,
            },
          });
        } else {
          const imgMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
          userContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${imgMime};base64,${fileBuffer.toString('base64')}`,
              detail: 'high',
            },
          });
        }

        const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content:
                  'You are a deterministic UAE port manifest & Delivery Order OCR engine. Return ONLY valid JSON matching the requested schema. Never invent values not present in the document.',
              },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 4000,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(35000),
        });

        if (oaRes.ok) {
          const oaData = (await oaRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = oaData.choices?.[0]?.message?.content ?? '';
          const parsed = cleanJsonResponse(text);
          if (parsed && Array.isArray(parsed.containers) && parsed.containers.length > 0) {
            const containers = mapParsedContainers(parsed.containers as Array<Record<string, unknown>>);
            if (containers.length > 0) {
              const result: ExtractedManifestResult = {
                blOrDoNumber: String(parsed.blOrDoNumber || '').trim(),
                shippingLine: String(parsed.shippingLine || '').trim(),
                vesselVoyage: String(parsed.vesselVoyage || '').trim(),
                customerName: String(parsed.customerName || '').trim(),
                terminalName: String(parsed.terminalName || '').trim(),
                warehouseName: String(parsed.warehouseName || '').trim(),
                shipmentType: String(parsed.shipmentType || '').toUpperCase() === 'EXPORT' ? 'EXPORT' : 'IMPORT',
                notes: String(parsed.notes || '').trim(),
                containers,
                provider: 'openai-vision',
                fileName,
                confidencePct: Number(parsed.confidencePct || 98),
              };
              return NextResponse.json({ ok: true, manifest: result });
            }
          }
        }
      } catch (err) {
        console.warn('[ocr-manifest] OpenAI vision error:', err);
      }
    }

    // 5. Deterministic Local Parser ONLY on clean extracted PDF text (never raw binary bytes)
    if (extractedPdfText.length > 10) {
      const fallbackParsed = parseRawTextFallback(extractedPdfText, fileName);
      if (fallbackParsed.containers.length > 0) {
        return NextResponse.json({ ok: true, manifest: fallbackParsed });
      }
    }

    return NextResponse.json(
      {
        error: isPdf
          ? 'Could not detect ISO 6346 container numbers in this PDF. Ensure the document contains valid container IDs or configure GEMINI_API_KEY / OPENAI_API_KEY for scanned PDFs.'
          : 'Could not extract container details from this image. Ensure the image clearly shows container numbers and GEMINI_API_KEY or OPENAI_API_KEY is configured.',
      },
      { status: 422 },
    );
  } catch (error) {
    console.error('[api/logistics/drayage/ocr-manifest POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse manifest document' },
      { status: 500 },
    );
  }
}
