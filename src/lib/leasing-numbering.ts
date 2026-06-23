import { prisma } from '@/lib/prisma';

const QUOTATION_PREFIX = 'QUO-LES';
const CONTRACT_PREFIX = 'CNT-LES';

const LEASE_TYPE_CODES: Record<string, string> = {
  LONG_TERM: 'LTL',
  SHORT_TERM: 'STL',
  DAILY: 'DLY',
  MONTHLY: 'MTL',
};

const COMPANY_STOP_WORDS = new Set([
  'AND',
  'THE',
  'OF',
  'FOR',
  'LLC',
  'L.L.C',
  'LTD',
  'LIMITED',
  'INC',
  'INCORPORATED',
  'CO',
  'COMPANY',
  'FZCO',
  'FZE',
  'PJSC',
  'LLP',
]);

function normalizeLeaseType(value?: string | null) {
  return String(value ?? 'LONG_TERM')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function leaseTypeCode(value?: string | null) {
  return LEASE_TYPE_CODES[normalizeLeaseType(value)] ?? 'LSE';
}

export function companyAbbreviation(name?: string | null) {
  const parts = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !COMPANY_STOP_WORDS.has(part));

  if (parts.length > 0) {
    const acronym = parts.map((part) => part[0]).join('').slice(0, 3);
    if (acronym.length === 3) return acronym;
    const flattened = parts.join('');
    return (acronym + flattened).slice(0, 3).padEnd(3, 'X');
  }

  const fallback = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (fallback.slice(0, 3) || 'GEN').padEnd(3, 'X');
}

function yearCode(date = new Date()) {
  return String(date.getFullYear()).slice(-2);
}

function nextSequenceFromValue(value: string | null | undefined) {
  if (!value) return 1;
  const seq = Number(value.slice(-4));
  return Number.isFinite(seq) && seq > 0 ? seq + 1 : 1;
}

export async function nextLeaseQuotationNumber(args: { leaseType?: string | null; date?: Date } = {}) {
  const date = args.date ?? new Date();
  const prefix = `${QUOTATION_PREFIX}-${leaseTypeCode(args.leaseType)}`;
  const yy = yearCode(date);
  const existing = await prisma.leaseQuotation.findFirst({
    where: { quotationNumber: { startsWith: `${prefix}-${yy}` } },
    orderBy: { quotationNumber: 'desc' },
    select: { quotationNumber: true },
  });
  const sequence = String(nextSequenceFromValue(existing?.quotationNumber)).padStart(4, '0');
  return `${prefix}-${yy}${sequence}`;
}

export async function nextLeaseContractNumber(args: { leaseType?: string | null; lesseeName?: string | null; date?: Date } = {}) {
  const date = args.date ?? new Date();
  const prefix = `${CONTRACT_PREFIX}-${leaseTypeCode(args.leaseType)}-${companyAbbreviation(args.lesseeName)}`;
  const yy = yearCode(date);
  const existing = await prisma.leaseContract2.findFirst({
    where: { contractNumber: { startsWith: `${prefix}-${yy}` } },
    orderBy: { contractNumber: 'desc' },
    select: { contractNumber: true },
  });
  const sequence = String(nextSequenceFromValue(existing?.contractNumber)).padStart(4, '0');
  return `${prefix}-${yy}${sequence}`;
}
