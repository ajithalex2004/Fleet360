/**
 * GET /api/agents/catalogue
 * --------------------------
 * Returns the full agent registry — used by the Intelligence Hub UI.
 */
import { NextResponse } from 'next/server';
import { AGENT_CATALOGUE } from '@/lib/agents/registry';

export async function GET() {
  return NextResponse.json({ agents: AGENT_CATALOGUE });
}
