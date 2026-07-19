import { NextResponse, NextRequest } from "next/server";
import { cookies } from 'next/headers';
import { DEFAULT_MODEL, runSunoRequest } from "@/lib/SunoApi";
import { accountTier } from '@/lib/account-pool';
import { withGenerationConcurrency } from '@/lib/concurrency-settings';
import { concurrencyLimitResponse } from '@/lib/concurrency-response';
import { corsHeaders } from "@/lib/utils";

export const maxDuration = 60; // allow longer timeout for wait_audio == true
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { prompt, tags, title, make_instrumental, model, wait_audio, negative_tags } = body;
      const audioInfo = await withGenerationConcurrency(async () => runSunoRequest(
        (await cookies()).toString(),
        accountTier(body.pool || req.headers.get('x-suno-pool')),
        (api) => api.custom_generate(
          prompt, tags, title,
          Boolean(make_instrumental),
          model || DEFAULT_MODEL,
          Boolean(wait_audio),
          negative_tags,
        ),
      ));
      return new NextResponse(JSON.stringify(audioInfo), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error: any) {
      console.error('Error generating custom audio:', error);
      const limited = concurrencyLimitResponse(error, corsHeaders);
      if (limited) return limited;
      return new NextResponse(JSON.stringify({ error: error.response?.data?.detail || error.toString() }), {
        status: error.response?.status || 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } else {
    return new NextResponse('Method Not Allowed', {
      headers: {
        Allow: 'POST',
        ...corsHeaders
      },
      status: 405
    });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}
