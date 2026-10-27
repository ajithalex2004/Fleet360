export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  try {
    const apkPath = path.join(process.cwd(), 'Fleet360-Driver.apk');
    const fallbackPath = path.join(process.cwd(), 'public', 'Fleet360-Driver.apk');
    const gradleOutputPath = path.join(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

    const resolvedPath = fs.existsSync(apkPath)
      ? apkPath
      : fs.existsSync(fallbackPath)
      ? fallbackPath
      : fs.existsSync(gradleOutputPath)
      ? gradleOutputPath
      : null;

    if (!resolvedPath) {
      return NextResponse.json({ error: 'Fleet360 Driver APK binary not found' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="Fleet360-Driver.apk"',
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[api/mobile/download-driver-apk GET]', err);
    return NextResponse.json({ error: 'Failed to download Fleet360 Driver APK' }, { status: 500 });
  }
}
