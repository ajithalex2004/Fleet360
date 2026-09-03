export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  try {
    const apkPath = path.join(process.cwd(), 'Fleet360 Booking App.apk');
    const fallbackPath = path.join(process.cwd(), 'public', 'Fleet360 Booking App.apk');

    const resolvedPath = fs.existsSync(apkPath) ? apkPath : fs.existsSync(fallbackPath) ? fallbackPath : null;

    if (!resolvedPath) {
      return NextResponse.json({ error: 'APK binary not found' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="Fleet360 Booking App.apk"',
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (err) {
    console.error('[api/mobile/download-apk GET]', err);
    return NextResponse.json({ error: 'Failed to download APK' }, { status: 500 });
  }
}
