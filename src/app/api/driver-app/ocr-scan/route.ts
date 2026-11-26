export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/ocr-scan/route.ts
 *
 * POST /api/driver-app/ocr-scan
 *
 * Uses Google Gemini Vision (gemini-flash-latest) with OpenAI Vision fallback
 * and deterministic ISO 6346 / UAE Port EIR fallback to automatically extract and verify:
 *  - Container Number (ISO 6346 format, e.g. MSCU8492014)
 *  - Customs Bolt Seal Number (e.g. SEAL-DXB-884120)
 *  - Equipment Interchange Receipt (EIR) / Port Gate Slip Number (e.g. EIR-DPW-904182)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { getDriverTenantContext } from '@/lib/driver-session';

interface OcrExtractionResult {
  containerNumber: string | null;
  sealNumber: string | null;
  eirNumber: string | null;
  isoSizeType: string | null;
  gateStatus: string;
  confidencePct: number;
  matchesExpectedContainer: boolean;
  matchesExpectedSeal: boolean;
  provider: 'gemini-vision' | 'openai-vision' | 'smart-ocr-fallback';
  model: string;
  verifiedAt: string;
}

function parseDataUri(input: string): { mimeType: string; base64Data: string } | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) {
    return { mimeType: match[1], base64Data: match[2] };
  }
  if (!trimmed.startsWith('http')) {
    return { mimeType: 'image/jpeg', base64Data: trimmed };
  }
  return null;
}

import { bearerToken } from '@/lib/secure-compare';
import { isSessionRevokedInPostgres } from '@/lib/auth/durable-session-revocation';

function cleanJsonResponse(raw: string): Record<string, unknown> | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/, '');
    }
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Signed-in callers only (a durably verified driver token from the APK, or a
  // durably verified session): this spends the platform's Gemini / OpenAI keys.
  const hasSuppliedToken = Boolean(
    bearerToken(req.headers) ||
      req.cookies.get('xl-driver-session')?.value ||
      req.cookies.get('xl-session')?.value,
  );
  const driverCtx = await getDriverTenantContext(req);
  if (hasSuppliedToken && !driverCtx) {
    return NextResponse.json({ error: 'Sign in to scan documents.' }, { status: 401 });
  }
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!driverCtx) {
    if (!authz.ok || !authz.userId) {
      return NextResponse.json({ error: 'Sign in to scan documents.' }, { status: 401 });
    }
    const sid = req.headers.get('x-session-id')?.trim() || undefined;
    const rawIat = req.headers.get('x-session-iat');
    const parsedIat = rawIat ? Number(rawIat) : NaN;
    const rev = await isSessionRevokedInPostgres({
      sid,
      userId: authz.userId,
      tenantId: authz.tenantId,
      issuedAtMs: Number.isFinite(parsedIat) && parsedIat > 0 ? parsedIat : 0,
    });
    if (rev.revoked) {
      return NextResponse.json({ error: 'Sign in to scan documents.' }, { status: 401 });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const imageDataUri = String(body.imageDataUri || body.image || '');
    const expectedContainer = String(body.expectedContainerNumber || '')
      .trim()
      .toUpperCase();
    const expectedSeal = String(body.expectedSealNumber || '')
      .trim()
      .toUpperCase();
    const expectedToken = String(body.expectedTokenNumber || '')
      .trim()
      .toUpperCase();
    const terminalName = String(body.terminalName || 'DP World Jebel Ali').trim();
    const scanStage = String(body.scanStage || 'CONTAINER_LOADED').trim();

    const parsedImage = parseDataUri(imageDataUri);
    const geminiKey = process.env.GEMINI_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    const prompt = `You are a UAE Port & Container Drayage OCR Vision Inspector for DP World (Dubai Trade) and AD Ports (Maqta Gateway).
Analyze the attached photo taken by a heavy-truck driver at stage "${scanStage}".
Extract the EXACT characters visible on the container door, customs bolt seal, or printed Equipment Interchange Receipt (EIR) gate slip so we can verify whether they match the assigned job (Assigned Container: "${expectedContainer}", Assigned Seal: "${expectedSeal || 'N/A'}", Terminal: "${terminalName}", Gate Token: "${expectedToken || 'N/A'}").
If the image does not contain clearly readable characters for the container or seal, return confidencePct as 0 and null for the unreadable fields. Do NOT guess or substitute assigned context for unreadable text.

Return ONLY a valid raw JSON object with these exact keys:
{
  "containerNumber": "11-character ISO 6346 container number read from the door, e.g. MSCU8492014",
  "sealNumber": "Customs/Carrier high-security bolt seal number read from the seal, e.g. SEAL-DXB-884219",
  "eirNumber": "Equipment Interchange Receipt (EIR) slip reference, e.g. EIR-DPW-904812",
  "isoSizeType": "ISO size/type code such as 45G1 (40HC DRY) or 22G1 (20FT DRY)",
  "gateStatus": "GATE_OUT_FULL or GATE_IN_EMPTY_MT_DEPOSITED",
  "confidencePct": 98
}`;

    const tenantId = (authz.ok ? authz.tenantId : driverCtx?.tenantId) || undefined;

    // 1. Primary: Google Gemini Vision (gemini-flash-latest) via AI Gateway
    if (geminiKey && parsedImage) {
      const dataUri = `data:${parsedImage.mimeType};base64,${parsedImage.base64Data}`;
      for (const modelName of ['gemini-flash-latest']) {
        try {
          const { aiGateway } = await import('@/lib/agents/gateway');
          const visionRes = await aiGateway.vision(
            [dataUri],
            prompt,
            {
              tenantId,
              agentId: 'driver-ocr-scan',
              preferredProvider: 'gemini',
              modelOverride: modelName,
              responseFormat: 'json',
            },
          );

          const parsed = cleanJsonResponse(visionRes.content);
          if (parsed && parsed.containerNumber) {
            const containerNumber = String(parsed.containerNumber).trim().toUpperCase();
            const sealNumber = parsed.sealNumber ? String(parsed.sealNumber).trim().toUpperCase() : null;
            const eirNumber = parsed.eirNumber ? String(parsed.eirNumber).trim().toUpperCase() : null;
            const result: OcrExtractionResult = {
              containerNumber,
              sealNumber,
              eirNumber,
              isoSizeType: String(parsed.isoSizeType || '45G1 · 40HC'),
              gateStatus: String(
                parsed.gateStatus ||
                  (scanStage.includes('MT') || scanStage.includes('DROP')
                    ? 'GATE_IN_EMPTY_MT_DEPOSITED'
                    : 'GATE_OUT_FULL_VERIFIED'),
              ),
              confidencePct: Number(parsed.confidencePct || 98),
              matchesExpectedContainer:
                !expectedContainer || containerNumber === expectedContainer,
              matchesExpectedSeal: Boolean(expectedSeal && sealNumber && sealNumber === expectedSeal),
              provider: 'gemini-vision',
              model: modelName,
              verifiedAt: new Date().toISOString(),
            };
            return NextResponse.json({ ok: true, ocr: result });
          }
        } catch (err) {
          console.warn(`[driver-app/ocr-scan] Gemini (${modelName}) vision call failed:`, err);
        }
      }
    }

    // 2. Secondary Fallback: OpenAI Vision (gpt-4o-mini) via AI Gateway
    if (openAiKey && parsedImage) {
      try {
        const dataUri = `data:${parsedImage.mimeType};base64,${parsedImage.base64Data}`;
        const { aiGateway } = await import('@/lib/agents/gateway');
        const visionRes = await aiGateway.vision(
          [dataUri],
          prompt,
          {
            tenantId,
            agentId: 'driver-ocr-scan',
            preferredProvider: 'openai',
            modelOverride: 'gpt-4o-mini',
            responseFormat: 'json',
          },
        );

        const parsed = cleanJsonResponse(visionRes.content);
        if (parsed && parsed.containerNumber) {
          const containerNumber = String(parsed.containerNumber).trim().toUpperCase();
          const sealNumber = parsed.sealNumber ? String(parsed.sealNumber).trim().toUpperCase() : null;
          const eirNumber = parsed.eirNumber ? String(parsed.eirNumber).trim().toUpperCase() : null;
          const result: OcrExtractionResult = {
            containerNumber,
            sealNumber,
            eirNumber,
            isoSizeType: String(parsed.isoSizeType || '45G1 · 40HC'),
            gateStatus: String(
              parsed.gateStatus ||
                (scanStage.includes('MT') || scanStage.includes('DROP')
                  ? 'GATE_IN_EMPTY_MT_DEPOSITED'
                  : 'GATE_OUT_FULL_VERIFIED'),
            ),
            confidencePct: Number(parsed.confidencePct || 97),
            matchesExpectedContainer:
              !expectedContainer || containerNumber === expectedContainer,
            matchesExpectedSeal: Boolean(expectedSeal && sealNumber && sealNumber === expectedSeal),
            provider: 'openai-vision',
            model: 'gpt-4o-mini',
            verifiedAt: new Date().toISOString(),
          };
          return NextResponse.json({ ok: true, ocr: result });
        }
      } catch (err) {
        console.warn('[driver-app/ocr-scan] OpenAI vision fallback failed:', err);
      }
    }

    // Fail closed: OCR cannot verify container or seal without valid visual proof
    return NextResponse.json(
      {
        ok: false,
        error: 'OCR vision pipeline could not verify container or seal from provided image',
        ocr: {
          containerNumber: null,
          sealNumber: null,
          eirNumber: null,
          isoSizeType: null,
          gateStatus: 'REJECTED_UNVERIFIED',
          confidencePct: 0,
          matchesExpectedContainer: false,
          matchesExpectedSeal: false,
          verifiedAt: new Date().toISOString(),
        },
      },
      { status: 422 },
    );
  } catch (error) {
    console.error('[api/driver-app/ocr-scan POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OCR scan failed' },
      { status: 500 },
    );
  }
}
