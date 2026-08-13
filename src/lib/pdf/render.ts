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

/**
 * Accepts any React element (FunctionComponentElement from `createElement`,
 * JSX <MyDoc />, etc.) rather than a specific `ReactElement<DocumentProps>`.
 *
 * Every PDF template is a function component that takes its own custom props
 * ({ data, lang } typically) and internally renders a `<Document>` from
 * @react-pdf/renderer. The type for the *outer* element isn't `DocumentProps`
 * — those are the props the *inner* Document receives. Widening the parameter
 * keeps the call sites typed naturally without an extra cast at each one.
 *
 * We then cast at the renderToBuffer boundary (where @react-pdf/renderer
 * does require ReactElement<DocumentProps>): every template component is
 * guaranteed to render a single <Document> at its root, so this is a sound
 * widening on top of the renderer's internal contract.
 */
export async function renderPdf(document: ReactElement): Promise<Buffer> {
  registerFonts();
  try {
    return await renderToBuffer(document as unknown as ReactElement<DocumentProps>);
  } catch (err) {
    captureException(err, { context: 'pdf.render' });
    throw err;
  }
}
