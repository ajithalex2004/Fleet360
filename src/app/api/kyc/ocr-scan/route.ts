export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseDocumentOcr } from '@/lib/digital-kyc-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const docType = body?.docType || 'EMIRATES_ID';
    const inputName = body?.name || 'Mohammed Al-Maktoum';

    const ocrResult = parseDocumentOcr(docType, inputName);

    return NextResponse.json({
      success: true,
      ocrResult,
    });
  } catch (err) {
    console.error('[api/kyc/ocr-scan POST]', err);
    return NextResponse.json({ error: 'OCR Scan processing failed' }, { status: 500 });
  }
}
