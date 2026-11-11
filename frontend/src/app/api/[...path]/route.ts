import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function proxyToBackend(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const backendBase = (process.env.BACKEND_INTERNAL_URL || 'http://backend:3001').replace(/\/$/, '');
  const targetUrl = new URL(`${backendBase}/api/${path.join('/')}`);
  targetUrl.search = req.nextUrl.search;

  const forwardHeaders = new Headers();
  const allowHeaders = [
    'content-type',
    'accept',
    'x-admin-key',
    'x-webhook-secret',
    'authorization',
  ];
  for (const h of allowHeaders) {
    const val = req.headers.get(h);
    if (val) forwardHeaders.set(h, val);
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
  const bodyBuffer = hasBody ? await req.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: hasBody && bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : undefined,
      cache: 'no-store',
    });

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);

    const rawBody = await upstream.arrayBuffer();
    return new NextResponse(rawBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Backend-Verbindung fehlgeschlagen',
        details: err instanceof Error ? err.message : 'Unbekannter Fehler',
      },
      { status: 502 }
    );
  }
}

export const GET = proxyToBackend;
export const POST = proxyToBackend;
export const PUT = proxyToBackend;
export const PATCH = proxyToBackend;
export const DELETE = proxyToBackend;
export const OPTIONS = proxyToBackend;
