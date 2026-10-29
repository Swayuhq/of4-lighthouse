// Brings the next comments from one connected channel. A live channel will call the same pipeline from its webhook.
import { NextResponse } from 'next/server';
import { isChannel } from '@/src/connectors';
import { pull } from '@/src/pipeline';

export async function POST(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel)) return NextResponse.json({ problem: 'Swayu cannot connect that channel yet.' }, { status: 404 });
  const url = new URL(request.url);
  const take = Math.min(Math.max(Number(url.searchParams.get('take')) || 1, 1), 50);
  try {
    return NextResponse.json(await pull(channel, take));
  } catch (e) {
    const problem = (e as Error).message;
    if (problem.endsWith('is not connected')) return NextResponse.json({ problem: `${problem}. Connect it first.` }, { status: 409 });
    throw e;
  }
}
