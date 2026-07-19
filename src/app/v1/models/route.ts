import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/lib/SunoApi';
import { corsHeaders } from '@/lib/utils';
import { requireApiKey } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;
  const created = Math.floor(Date.now() / 1000);
  return NextResponse.json({
    object: 'list',
    data: [
      { id: DEFAULT_MODEL, object: 'model', created, owned_by: 'suno-api', capabilities: ['music'] },
      { id: 'suno-music', object: 'model', created, owned_by: 'suno-api', capabilities: ['music'] },
    ],
  }, { headers: corsHeaders });
}
