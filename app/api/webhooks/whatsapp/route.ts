// Meta's WhatsApp webhook. GET proves to Meta we own this address; POST brings customer messages into the same pipeline as every channel.
import { NextResponse } from 'next/server';
import { signatureOk, whatsappItems } from '@/src/whatsapp';
import { receive } from '@/src/pipeline';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const token = process.env.SWAYU_WHATSAPP_VERIFY_TOKEN;
  if (q.get('hub.mode') !== 'subscribe' || !token || q.get('hub.verify_token') !== token) return new NextResponse(null, { status: 403 });
  return new NextResponse(q.get('hub.challenge') ?? '', { status: 200 });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!signatureOk(body, request.headers.get('x-hub-signature-256'), process.env.SWAYU_META_APP_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  // Meta retries anything that is not a 200 for seven days, and storing dedupes on id, so a failed store is safe to retry.
  await receive('whatsapp', whatsappItems(JSON.parse(body)));
  return new NextResponse(null, { status: 200 });
}
