/**
 * Server-side PDF rendering — wraps @react-pdf/renderer's renderToBuffer
 * with our font registration and consistent error handling.
 *
 * Use from API routes:
 *   import { renderPdf } from '@/lib/pdf/render';
 *   const buffer = await renderPdf(<QuotationPdf data={...} lang="en" />);
 *   return new Response(buffer, {
 *     headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="..."' },
 *   });
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { registerFonts } from './fonts';
import { captureException } from '@/lib/sentry';

export async function renderPdf(document: ReactElement): Promise<Buffer> {
  registerFonts();
  try {
    return await renderToBuffer(document as ReactElement<DocumentProps>);
  } catch (err) {
    captureException(err, { context: 'pdf.render' });
    throw err;
  }
}
