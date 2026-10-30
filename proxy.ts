// The tunnel guard. A tunnel gives this laptop a public address so Meta can deliver webhooks.
// Anything that does not arrive as the laptop itself may reach the webhooks and nothing else, so the inbox and its reply button stay private.
import { NextResponse, type NextRequest } from 'next/server';

const LOCAL = new Set(['127.0.0.1', 'localhost']);

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '');
  if (LOCAL.has(host) || request.nextUrl.pathname.startsWith('/api/webhooks/')) return NextResponse.next();
  return new NextResponse(null, { status: 404 });
}
