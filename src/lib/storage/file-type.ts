/**
 * What an uploaded file really is, from its first bytes, instead of the type
 * the browser reports (which the uploader controls). Upload routes accept a
 * file only when its contents match an allowed kind, so a page, script or
 * executable can't be stored under a .pdf or image name.
 */

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'ooxml' | 'ole' | 'text';

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/** The kind of `buf`, or null when it is none of the kinds uploads accept. */
export function detectFileKind(buf: Uint8Array): FileKind | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';                    // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';                          // GIF8
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'ooxml';                        // zip: .docx/.xlsx
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';  // legacy .doc/.xls
  if (isPlainText(buf)) return 'text';
  return null;
}

/** UTF-8 text with no NUL bytes that doesn't open like markup a browser would render. */
function isPlainText(buf: Uint8Array): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, 4096);
  if (sample.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    // A multi-byte character cut at the sample boundary is still text.
    if (sample.length < 4096) return false;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, 4090));
    } catch {
      return false;
    }
  }
  return !/^\s*</.test(text.replace(/^﻿/, ''));
}

/** The kinds each file extension may hold. */
const EXTENSION_KINDS: Record<string, FileKind[]> = {
  '.pdf': ['pdf'],
  '.png': ['png'],
  '.jpg': ['jpeg'],
  '.jpeg': ['jpeg'],
  '.gif': ['gif'],
  '.webp': ['webp'],
  '.docx': ['ooxml'],
  '.xlsx': ['ooxml'],
  '.doc': ['ole'],
  '.xls': ['ole'],
  '.txt': ['text'],
  '.csv': ['text'],
};

export const IMAGE_KINDS: readonly FileKind[] = ['png', 'jpeg', 'gif', 'webp'];

/**
 * Why `buf`, uploaded as `fileName`, isn't acceptable, or null when its
 * contents are one of `allowed` and match its extension.
 */
export function fileContentProblem(fileName: string, buf: Uint8Array, allowed: readonly FileKind[]): string | null {
  const kind = detectFileKind(buf);
  if (!kind || !allowed.includes(kind)) return 'The file type is not accepted.';
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  const expected = EXTENSION_KINDS[ext];
  if (!expected || !expected.includes(kind)) return 'The file contents don\'t match its extension.';
  return null;
}
