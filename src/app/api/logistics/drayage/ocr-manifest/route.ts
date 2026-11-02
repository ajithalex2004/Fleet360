export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
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

function normalizeSize(raw: unknown): '20FT' | '40FT' | '40HC' | '45HC' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.includes('45') || s.startsWith('L5') || s.startsWith('95')) return '45HC';
  if (s.includes('20') || s.startsWith('22') || s.startsWith('20G')) return '20FT';
  if (s.includes('HC') || s.includes('HQ') || s.includes('HIGH') || s.startsWith('45G') || s.startsWith('45R')) {
    return '40HC';
  }
  if (s.includes('40') || s.startsWith('42') || s.startsWith('40G')) return '40FT';
  return '40HC';
}

function normalizeType(raw: unknown): 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.includes('REEF') || s.includes('RF') || s.includes('COLD') || /^[24][25]R/.test(s)) return 'REEFER';
  if (s.includes('OPEN') || s.includes('OT') || /^[24][25]U/.test(s)) return 'OPEN_TOP';
  if (s.includes('FLAT') || s.includes('FR') || /^[24][25]P/.test(s)) return 'FLAT_RACK';
  return 'DRY';
}

function normalizeBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1' || s === 'REQUIRED' || s === 'CHECKED';
}

function normalizeDate(raw: unknown): string {
  if (!raw) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (!str) return '';

  // YYYY-MM-DD
  const isoMatch = str.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const dayNum = Number(d);
    const monNum = Number(m);
    if (monNum >= 1 && monNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return `${y}-${String(monNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }
  }

  // DD MMM YYYY or DD-MMM-YYYY (e.g. 12 Nov 2026)
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const namedMatch = str.toUpperCase().match(/\b(\d{1,2})[\s/-]+([A-Z]{3})[A-Z]*[\s/,-]+(\d{4})\b/);
  if (namedMatch && months[namedMatch[2]]) {
    return `${namedMatch[3]}-${months[namedMatch[2]]}-${namedMatch[1].padStart(2, '0')}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020 && parsed.getFullYear() <= 2035) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function normalizeTime(raw: unknown): string {
  if (!raw) return '';
  const str = String(raw).trim();
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

function cleanContainerNumber(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isoMatch = s.match(/[A-Z]{3}[UJZ]\d{6,7}/);
  if (isoMatch) return isoMatch[0];
  return s;
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
    const containerNumber = cleanContainerNumber(rawCntr);
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
    });
  }

  // Fallback: if spreadsheet had no standard column headers, scan all cells for ISO 6346 container numbers
  if (containers.length === 0) {
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    const seen = new Set<string>();
    for (const rowArr of rawMatrix) {
      if (!Array.isArray(rowArr)) continue;
      const rowStr = rowArr.map((c) => String(c ?? '')).join(' ');
      const matches = rowStr.toUpperCase().match(/\b[A-Z]{3}[UJZ]\s*-?\s*\d{6}\s*-?\s*\d\b/g) || [];
      for (const m of matches) {
        const clean = m.replace(/[^A-Z0-9]/g, '');
        if (!seen.has(clean)) {
          seen.add(clean);
          containers.push({
            containerNumber: clean,
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

function parseRawTextFallback(text: string, fileName: string): ExtractedManifestResult {
  const upper = text.toUpperCase();
  const seen = new Set<string>();
  const containers: ExtractedManifestContainer[] = [];

  // Extract DO / BL reference
  const doMatch = text.match(/\b(?:DELIVERY\s*ORDER|D\.?O\.?\s*(?:NO|NUMBER|#)?|B\/L\s*(?:NO|NUMBER)?|BOOKING\s*(?:NO|REF)?)[\s#:.-]*([A-Z0-9/-]{5,24})\b/i);
  const blOrDoNumber = doMatch?.[1]?.trim() || '';

  // Shipping line detection
  const lines = ['MSC', 'MAERSK', 'CMA CGM', 'HAPAG-LLOYD', 'COSCO', 'EVERGREEN', 'ONE', 'OOCL', 'HMM', 'YANG MING', 'PIL', 'ZIM'];
  const shippingLine = lines.find((l) => upper.includes(l)) || '';

  // Terminal detection
  let terminalName = '';
  if (upper.includes('KHALIFA') || upper.includes('KPCT') || upper.includes('AD PORTS')) {
    terminalName = 'Khalifa Port';
  } else if (upper.includes('TERMINAL 3') || upper.includes('T3')) {
    terminalName = 'Jebel Ali Port - Terminal 3';
  } else if (upper.includes('TERMINAL 2') || upper.includes('T2')) {
    terminalName = 'Jebel Ali Port - Terminal 2';
  } else if (upper.includes('JEBEL ALI') || upper.includes('DP WORLD') || upper.includes('TERMINAL 1')) {
    terminalName = 'Jebel Ali Port - Terminal 1';
  }

  // Dates in document
  const allDates: string[] = [];
  const datePatterns = text.match(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/,-]+\d{4})\b/g) || [];
  for (const dp of datePatterns) {
    const norm = normalizeDate(dp);
    if (norm && !allDates.includes(norm)) {
      allDates.push(norm);
    }
  }
  allDates.sort();
  const dischargeDate = allDates[0] || '';
  const doExpiryDate = allDates.length > 1 ? allDates[allDates.length - 1] : '';

  // Seals & weights
  const sealMatches = Array.from(text.matchAll(/\b(?:SEAL|SL|BOLT)(?:\s*(?:NO|NUMBER|#))?[\s:.-]*([A-Z0-9-]{5,16})\b/gi)).map((m) => m[1].toUpperCase());
  const weightMatches = Array.from(text.matchAll(/\b(\d{4,5}(?:\.\d+)?)\s*(?:KG|KGS)\b/gi)).map((m) => Number(m[1]));

  // Extract ISO 6346 container numbers
  const isoRegex = /\b([A-Z]{3}[UJZ])\s*-?\s*(\d{6})\s*-?\s*(\d)\b/gi;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = isoRegex.exec(text)) !== null) {
    const fullCntr = `${match[1]}${match[2]}${match[3]}`.toUpperCase();
    if (seen.has(fullCntr)) continue;
    seen.add(fullCntr);

    // Inspect window around the container match for size/type/seal/weight
    const start = Math.max(0, match.index - 60);
    const end = Math.min(text.length, match.index + 180);
    const snippet = text.slice(start, end);

    const snippetWeight = snippet.match(/\b(\d{4,5}(?:\.\d+)?)\s*(?:KG|KGS)?\b/i);
    const snippetSeal = snippet.match(/\b(?:SEAL|SL)?[\s:.-]*([A-Z]{2,4}-?\d{5,10})\b/i);

    containers.push({
      containerNumber: fullCntr,
      size: normalizeSize(snippet),
      containerType: normalizeType(snippet),
      sealNumber: snippetSeal?.[1]?.toUpperCase() || sealMatches[idx] || '',
      weightKg: snippetWeight ? Number(snippetWeight[1]) : (weightMatches[idx] || 0),
      dischargeDate,
      deliveryDate: dischargeDate,
      deliveryTime: '',
      doExpiryDate,
      doExpiryTime: '',
      customsInspection: upper.includes('CUSTOMS'),
      municipalityInspection: upper.includes('MUNICIPALITY') || upper.includes('DM INSPECTION'),
      cpipInspection: upper.includes('CPIP'),
      mercInspection: upper.includes('FUMIGATION') || upper.includes('MERC'),
      boxcareInspection: upper.includes('BOXCARE'),
    });
    idx++;
  }

  return {
    blOrDoNumber,
    shippingLine,
    vesselVoyage: '',
    customerName: '',
    terminalName,
    warehouseName: '',
    shipmentType: upper.includes('EXPORT') ? 'EXPORT' : 'IMPORT',
    notes: [
      blOrDoNumber ? `DO/BL: ${blOrDoNumber}` : '',
      shippingLine ? `Line: ${shippingLine}` : '',
    ].filter(Boolean).join(' • '),
    containers,
    provider: 'pdf-smart-parser',
    fileName,
    confidencePct: containers.length > 0 ? 94 : 0,
  };
}

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

    // 2. Extract embedded text if PDF
    let extractedPdfText = '';
    const isPdf = lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
    if (isPdf) {
      try {
        const pdfParseMod = await import('pdf-parse');
        const pdfParseFn = (pdfParseMod as unknown as { default?: (buf: Buffer) => Promise<{ text?: string }> }).default
          || (pdfParseMod as unknown as (buf: Buffer) => Promise<{ text?: string }>);
        if (typeof pdfParseFn === 'function') {
          const parsedPdf = await pdfParseFn(fileBuffer);
          extractedPdfText = parsedPdf?.text || '';
        }
      } catch {
        // Fallback: extract printable ASCII strings from PDF buffer
        extractedPdfText = fileBuffer.toString('latin1').replace(/[^\x20-\x7E\r\n]/g, ' ');
      }
    }

    // 3. AI Vision / Document OCR (Google Gemini 2.0 Flash / OpenAI Vision)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    const openAiKey =
      process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dev-openai-key'
        ? process.env.OPENAI_API_KEY
        : '';

    const aiPrompt = `You are an expert UAE Port Drayage & Shipping Manifest OCR extractor for DP World (Dubai Trade) and AD Ports (Maqta Gateway).
Extract ALL shipping containers and Delivery Order (DO) / Bill of Lading (BL) header details from the provided document.
IMPORTANT RULES:
- Only extract real containers and values actually present in the document. Do NOT invent or fabricate random container numbers or dummy dates.
- Normalize dates to YYYY-MM-DD format if present, or "" if not present.
- Normalize container size to one of: "20FT", "40FT", "40HC", "45HC".
- Normalize containerType to one of: "DRY", "REEFER", "OPEN_TOP", "FLAT_RACK".

Return ONLY a valid raw JSON object with this exact structure:
{
  "blOrDoNumber": "Extracted DO or B/L number or empty string",
  "shippingLine": "Shipping line name (e.g. MSC, Maersk, CMA CGM) or empty string",
  "vesselVoyage": "Vessel & Voyage if present or empty string",
  "customerName": "Consignor / Importer / Customer company name if present or empty string",
  "terminalName": "Port terminal name (e.g. Jebel Ali Port - Terminal 1, Khalifa Port) or empty string",
  "warehouseName": "Consignee / Delivery place if present or empty string",
  "shipmentType": "IMPORT or EXPORT",
  "notes": "Brief summary of DO/BL reference, vessel, or port gate instructions",
  "confidencePct": 98,
  "containers": [
    {
      "containerNumber": "MSCU8492014",
      "size": "40HC",
      "containerType": "DRY",
      "sealNumber": "SL123456 or empty string",
      "weightKg": 22400,
      "dischargeDate": "YYYY-MM-DD or empty string",
      "deliveryDate": "YYYY-MM-DD or empty string",
      "deliveryTime": "HH:MM or empty string",
      "doExpiryDate": "YYYY-MM-DD or empty string",
      "doExpiryTime": "HH:MM or empty string",
      "customsInspection": false,
      "municipalityInspection": false,
      "cpipInspection": false,
      "mercInspection": false,
      "boxcareInspection": false
    }
  ]
}`;

    if (geminiKey) {
      const effectiveMime = isPdf
        ? 'application/pdf'
        : mimeType.startsWith('image/')
          ? mimeType
          : 'image/jpeg';

      for (const modelName of ['gemini-2.0-flash', 'gemini-flash-latest']) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
          const parts: Array<Record<string, unknown>> = [{ text: aiPrompt }];
          if (extractedPdfText.trim().length > 20) {
            parts.push({ text: `\nExtracted PDF Text:\n${extractedPdfText.slice(0, 30000)}` });
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
                temperature: 0.1,
                maxOutputTokens: 4096,
              },
            }),
            signal: AbortSignal.timeout(25000),
          });

          if (geminiRes.ok) {
            const data = (await geminiRes.json()) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            const parsed = cleanJsonResponse(text);
            if (parsed && Array.isArray(parsed.containers) && parsed.containers.length > 0) {
              const containers: ExtractedManifestContainer[] = (
                parsed.containers as Array<Record<string, unknown>>
              )
                .map((c) => {
                  const delivDate = normalizeDate(c.deliveryDate || c.dischargeDate);
                  return {
                    containerNumber: cleanContainerNumber(c.containerNumber),
                    size: normalizeSize(c.size),
                    containerType: normalizeType(c.containerType),
                    sealNumber: String(c.sealNumber || '').trim().toUpperCase(),
                    weightKg: Number(c.weightKg) || 0,
                    dischargeDate: delivDate,
                    deliveryDate: delivDate,
                    deliveryTime: normalizeTime(c.deliveryTime),
                    doExpiryDate: normalizeDate(c.doExpiryDate),
                    doExpiryTime: normalizeTime(c.doExpiryTime),
                    customsInspection: Boolean(c.customsInspection),
                    municipalityInspection: Boolean(c.municipalityInspection),
                    cpipInspection: Boolean(c.cpipInspection),
                    mercInspection: Boolean(c.mercInspection),
                    boxcareInspection: Boolean(c.boxcareInspection),
                  };
                })
                .filter((c) => c.containerNumber.length >= 4);

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
                  confidencePct: Number(parsed.confidencePct || 98),
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

    // 4. OpenAI Fallback (Vision for images or Text for PDFs)
    if (openAiKey && (mimeType.startsWith('image/') || extractedPdfText.trim().length > 10)) {
      try {
        const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: aiPrompt }];
        if (extractedPdfText.trim().length > 10) {
          userContent.push({
            type: 'text',
            text: `\nDocument Text:\n${extractedPdfText.slice(0, 25000)}`,
          });
        } else if (mimeType.startsWith('image/')) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${fileBuffer.toString('base64')}`,
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
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: userContent }],
            max_tokens: 3000,
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (oaRes.ok) {
          const oaData = (await oaRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = oaData.choices?.[0]?.message?.content ?? '';
          const parsed = cleanJsonResponse(text);
          if (parsed && Array.isArray(parsed.containers) && parsed.containers.length > 0) {
            const containers: ExtractedManifestContainer[] = (
              parsed.containers as Array<Record<string, unknown>>
            )
              .map((c) => {
                const delivDate = normalizeDate(c.deliveryDate || c.dischargeDate);
                return {
                  containerNumber: cleanContainerNumber(c.containerNumber),
                  size: normalizeSize(c.size),
                  containerType: normalizeType(c.containerType),
                  sealNumber: String(c.sealNumber || '').trim().toUpperCase(),
                  weightKg: Number(c.weightKg) || 0,
                  dischargeDate: delivDate,
                  deliveryDate: delivDate,
                  deliveryTime: normalizeTime(c.deliveryTime),
                  doExpiryDate: normalizeDate(c.doExpiryDate),
                  doExpiryTime: normalizeTime(c.doExpiryTime),
                  customsInspection: Boolean(c.customsInspection),
                  municipalityInspection: Boolean(c.municipalityInspection),
                  cpipInspection: Boolean(c.cpipInspection),
                  mercInspection: Boolean(c.mercInspection),
                  boxcareInspection: Boolean(c.boxcareInspection),
                };
              })
              .filter((c) => c.containerNumber.length >= 4);

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
                confidencePct: Number(parsed.confidencePct || 97),
              };
              return NextResponse.json({ ok: true, manifest: result });
            }
          }
        }
      } catch (err) {
        console.warn('[ocr-manifest] OpenAI fallback error:', err);
      }
    }

    // 5. Local Smart Parser for PDFs / Text documents
    const rawTextToScan =
      extractedPdfText || fileBuffer.toString('latin1').replace(/[^\x20-\x7E\r\n]/g, ' ');
    const fallbackParsed = parseRawTextFallback(rawTextToScan, fileName);

    if (fallbackParsed.containers.length === 0) {
      return NextResponse.json(
        {
          error: isPdf
            ? 'Could not detect ISO 6346 container numbers in this PDF. If this is a scanned image PDF, configure GEMINI_API_KEY or upload an Excel/CSV manifest.'
            : 'Image OCR requires GEMINI_API_KEY or OPENAI_API_KEY in environment variables, or upload a digital PDF / Excel (.xlsx) / CSV manifest.',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true, manifest: fallbackParsed });
  } catch (error) {
    console.error('[api/logistics/drayage/ocr-manifest POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse manifest document' },
      { status: 500 },
    );
  }
}
