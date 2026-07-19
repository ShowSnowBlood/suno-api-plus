import { NextResponse } from 'next/server';
import { GenerationConcurrencyLimitError } from '@/lib/concurrency-settings';

export function concurrencyLimitResponse(
  error: unknown,
  headers: Record<string, string> = {},
): NextResponse | null {
  if (!(error instanceof GenerationConcurrencyLimitError)) return null;

  return NextResponse.json(
    {
      error: {
        message: error.message,
        type: 'rate_limit_error',
        code: error.code,
        limit: error.limit,
        active_requests: error.activeRequests,
        retry_after: error.retryAfterSeconds,
      },
    },
    {
      status: error.status,
      headers: {
        ...headers,
        'Retry-After': String(error.retryAfterSeconds),
      },
    },
  );
}
