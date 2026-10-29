// The backend door for channels. The screen only reads and connects channels through here.
import { NextResponse } from 'next/server';
import { ADAPTERS, CHANNELS, coverage, isChannel } from '@/src/connectors';
import { connect, connections } from '@/src/store/db';

/** Every channel the owner can connect, whether it is connected, and whether the counts can be trusted. */
export async function GET() {
  const rows = await connections();
  const byChannel = new Map(rows.map(r => [r.channel, r]));
  return NextResponse.json({
    channels: CHANNELS.map(channel => {
      const row = byChannel.get(channel);
      return { channel, label: ADAPTERS[channel].label, mode: ADAPTERS[channel].mode, status: row?.status ?? 'not_connected', problem: row?.problem ?? null };
    }),
    coverage: coverage(rows),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const channel = typeof body?.channel === 'string' ? body.channel : '';
  if (!isChannel(channel)) return NextResponse.json({ problem: 'Swayu cannot connect that channel yet.' }, { status: 400 });
  await connect(channel);
  return NextResponse.json({ channel, status: 'connected' });
}
