/**
 * UAE Federal Tax Authority (FTA) & GCC Unified e-Invoicing
 * Tag-Length-Value (TLV) Base64 QR Code Encoder & Decoder.
 *
 * TLV Binary Layout per field:
 * - [Tag: 1 byte (uint8)]
 * - [Length: 1 or 2 bytes (UTF-8 byte length of value)]
 * - [Value: N UTF-8 bytes]
 *
 * Standard Tags:
 * - Tag 1: Seller Legal Name
 * - Tag 2: Seller VAT Tax Registration Number (15-digit TRN)
 * - Tag 3: Invoice Issue Timestamp (ISO 8601, e.g. 2026-09-01T12:00:00Z)
 * - Tag 4: Invoice Total (inclusive of VAT, 2 decimal places)
 * - Tag 5: VAT Total (2 decimal places)
 * - Tag 6: SHA-256 Hash of UBL 2.1 XML Invoice (optional Phase 2 / PINT AE)
 * - Tag 7: Cryptographic Stamp / Signature (optional Phase 2)
 * - Tag 8: Public Key / Scheme Identifier (optional Phase 2)
 */

export interface FtaQrInput {
  sellerName: string;
  sellerTrn: string;
  timestamp: string;
  totalWithVat: number | string;
  vatTotal: number | string;
  xmlHash?: string;
  signature?: string;
  publicKey?: string;
}

export interface DecodedFtaQrPayload {
  sellerName: string;
  sellerTrn: string;
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
  xmlHash?: string;
  signature?: string;
  publicKey?: string;
  rawTags: Record<number, string>;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function formatAmount(val: number | string): string {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function normalizeIsoTimestamp(ts: string): string {
  const trimmed = (ts ?? '').trim();
  if (!trimmed) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }
  return trimmed;
}

/**
 * Encodes a single TLV entry. Uses 1-byte length up to 255 bytes (standard for FTA QR tags).
 */
function encodeTlvField(tag: number, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const valueBytes = encoder.encode(value);
  const length = Math.min(valueBytes.length, 255);
  const chunk = new Uint8Array(2 + length);
  chunk[0] = tag & 0xff;
  chunk[1] = length & 0xff;
  chunk.set(valueBytes.subarray(0, length), 2);
  return chunk;
}

/**
 * Generates a Base64-encoded TLV QR payload compliant with UAE FTA / PINT AE e-Invoicing.
 */
export function generateFtaTlvQrBase64(input: FtaQrInput): string {
  const entries: Array<[number, string]> = [
    [1, (input.sellerName || 'Unknown Seller').trim()],
    [2, (input.sellerTrn || '').replace(/[-\s]/g, '')],
    [3, normalizeIsoTimestamp(input.timestamp)],
    [4, formatAmount(input.totalWithVat)],
    [5, formatAmount(input.vatTotal)],
  ];

  if (input.xmlHash) entries.push([6, input.xmlHash]);
  if (input.signature) entries.push([7, input.signature]);
  if (input.publicKey) entries.push([8, input.publicKey]);

  const chunks = entries.map(([tag, val]) => encodeTlvField(tag, val));
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const buffer = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytesToBase64(buffer);
}

/**
 * Decodes a Base64-encoded TLV QR payload back into its structured fields.
 */
export function decodeFtaTlvQrBase64(base64: string): DecodedFtaQrPayload {
  const bytes = base64ToBytes(base64.trim());
  const decoder = new TextDecoder();
  const rawTags: Record<number, string> = {};

  let offset = 0;
  while (offset + 2 <= bytes.byteLength) {
    const tag = bytes[offset];
    const len = bytes[offset + 1];
    offset += 2;
    if (offset + len > bytes.byteLength) break;
    const valBytes = bytes.subarray(offset, offset + len);
    rawTags[tag] = decoder.decode(valBytes);
    offset += len;
  }

  return {
    sellerName: rawTags[1] ?? '',
    sellerTrn: rawTags[2] ?? '',
    timestamp: rawTags[3] ?? '',
    totalWithVat: rawTags[4] ?? '0.00',
    vatTotal: rawTags[5] ?? '0.00',
    xmlHash: rawTags[6],
    signature: rawTags[7],
    publicKey: rawTags[8],
    rawTags,
  };
}
