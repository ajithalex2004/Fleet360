/**
 * Bounded ZIP reader for document batch uploads.
 *
 * The previous unpacker inflated every entry with no output limit, so a few
 * kilobytes of upload could expand into gigabytes in the app's memory (a ZIP
 * bomb). It also read sizes from the local headers only, which are zero for
 * entries written in streaming mode (flag bit 3, sizes in a trailing data
 * descriptor), so those files came out empty.
 *
 * Entries are taken from the central directory, the authoritative index;
 * archives without one fall back to a local-header scan. Limits are checked
 * against the declared sizes before inflating, and enforced again by
 * zlib's maxOutputLength.
 */
import zlib from 'zlib';

export const ZIP_LIMITS = {
  maxEntries: 200,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

interface RawEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD is 22 bytes plus a comment of up to 65535 bytes.
  if (buf.length < 22) return -1;
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function localDataStart(buf: Buffer, headerOffset: number): number {
  if (headerOffset + 30 > buf.length || buf.readUInt32LE(headerOffset) !== SIG_LOCAL) {
    throw new ZipLimitError('Corrupt ZIP: central directory points at no local header');
  }
  return headerOffset + 30 + buf.readUInt16LE(headerOffset + 26) + buf.readUInt16LE(headerOffset + 28);
}

function centralDirectoryEntries(buf: Buffer, eocd: number, limits: typeof ZIP_LIMITS): RawEntry[] {
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipLimitError('ZIP64 archives are not supported');
  if (count > limits.maxEntries) throw new ZipLimitError(`ZIP has ${count} entries; the limit is ${limits.maxEntries}`);

  const entries: RawEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipLimitError('Corrupt ZIP central directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new ZipLimitError('ZIP64 entries are not supported');
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      compressedSize,
      uncompressedSize,
      dataStart: localDataStart(buf, buf.readUInt32LE(p + 42)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localHeaderEntries(buf: Buffer, limits: typeof ZIP_LIMITS): RawEntry[] {
  const entries: RawEntry[] = [];
  let p = 0;
  while (p + 30 <= buf.length) {
    if (buf.readUInt32LE(p) !== SIG_LOCAL) {
      p++;
      continue;
    }
    const flags = buf.readUInt16LE(p + 6);
    const compressedSize = buf.readUInt32LE(p + 18);
    const dataStart = localDataStart(buf, p);
    // Without a central directory, a streamed entry's size is unknown.
    if (flags & 0x08) throw new ZipLimitError('ZIP entry sizes are in data descriptors and the archive has no central directory');
    entries.push({
      name: buf.toString('utf8', p + 30, p + 30 + buf.readUInt16LE(p + 26)),
      flags,
      method: buf.readUInt16LE(p + 8),
      compressedSize,
      uncompressedSize: buf.readUInt32LE(p + 22),
      dataStart,
    });
    if (entries.length > limits.maxEntries) throw new ZipLimitError(`ZIP has more than ${limits.maxEntries} entries`);
    p = dataStart + compressedSize;
  }
  return entries;
}

/**
 * The archive's files (directories and OS metadata skipped), within the
 * limits. Throws ZipLimitError on a limit or a corrupt archive; an entry
 * that is encrypted or uses an unsupported compression method is skipped.
 */
export function readZipEntries(buf: Buffer, limits: typeof ZIP_LIMITS = ZIP_LIMITS): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const raw = eocd >= 0 ? centralDirectoryEntries(buf, eocd, limits) : localHeaderEntries(buf, limits);

  const out: ZipEntry[] = [];
  let total = 0;
  for (const e of raw) {
    const base = e.name.split('/').pop() ?? e.name;
    if (e.name.endsWith('/') || e.name.includes('__MACOSX') || base.startsWith('.')) continue;
    if (e.flags & 0x01) continue; // encrypted
    if (e.uncompressedSize > limits.maxEntryBytes) {
      throw new ZipLimitError(`ZIP entry "${base}" is ${e.uncompressedSize} bytes; the limit is ${limits.maxEntryBytes}`);
    }
    if (e.dataStart + e.compressedSize > buf.length) throw new ZipLimitError(`Corrupt ZIP: entry "${base}" runs past the end`);
    const slice = buf.subarray(e.dataStart, e.dataStart + e.compressedSize);

    let data: Buffer;
    if (e.method === 0) {
      data = slice;
    } else if (e.method === 8) {
      try {
        // maxOutputLength holds even if the declared size lies.
        data = zlib.inflateRawSync(slice, { maxOutputLength: limits.maxEntryBytes });
      } catch (err) {
        if (err instanceof RangeError || (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new ZipLimitError(`ZIP entry "${base}" expands past ${limits.maxEntryBytes} bytes`);
        }
        console.warn(`[zip-reader] Failed to inflate entry "${base}":`, err);
        continue;
      }
    } else {
      continue;
    }

    total += data.length;
    if (total > limits.maxTotalBytes) throw new ZipLimitError(`ZIP contents exceed ${limits.maxTotalBytes} bytes`);
    out.push({ name: e.name, data });
  }
  return out;
}
