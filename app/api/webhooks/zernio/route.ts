// Zernio's webhook. Each new comment and review is pushed here within seconds, into the same pipeline as every channel.
// Zernio tries again unless it gets a 2xx within 5 seconds, so the answer comes first and the readers run after it.
import { NextResponse, after } from 'next/server';
import { pushSignatureOk, readPush } from '@/src/zernio-push';
import { readNew, receivePush } from '@/src/pipeline';
import { draftWaiting } from '@/src/drafting';

/** A comment or review event is a few kilobytes. Anything far larger is not one. */
const MAX_BYTES = 256_000;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  const header = request.headers.get('x-zernio-signature') ?? request.headers.get('x-late-signature');
  if (!pushSignatureOk(body, header, process.env.SWAYU_ZERNIO_WEBHOOK_SECRET)) return new NextResponse(null, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const push = readPush(payload);
  if (!push) return new NextResponse(null, { status: 400 });
  // A store that throws answers 500, and the whole event rolls back, so Zernio's retry is taken as new.
  const outcome = await receivePush('zernio', push);
  if (outcome === 'stored') after(async () => { await readNew(); draftWaiting(); });
  return new NextResponse(null, { status: 200 });
}
