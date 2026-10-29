// What the owner sees about each channel. Built on the server from the connection rows and the stored messages.
import { ADAPTERS, CHANNELS, type Channel } from '@/src/connectors';
import { connections } from '@/src/store/db';

export type ChannelView = {
  channel: Channel;
  label: string;
  reads: string;
  sample: boolean;
  status: 'not_connected' | 'connected' | 'broken';
  problem: string | null;
  caught: number;
  checkedAt: string | null;
};

const READS: Record<Channel, string> = {
  instagram: 'Comments on your posts',
  facebook: 'Comments on your Page',
  whatsapp: 'Chats with your business number',
  google_reviews: 'Reviews of your business',
};

/** Every channel in a fixed order. Caught counts messages stored from that channel, which the books keep by channel label. */
export async function channelViews(messages: { thread: string }[]): Promise<ChannelView[]> {
  const rows = new Map((await connections()).map(r => [r.channel, r]));
  return CHANNELS.map(channel => {
    const row = rows.get(channel);
    const { label, mode } = ADAPTERS[channel];
    return {
      channel,
      label,
      reads: READS[channel],
      sample: mode === 'sample',
      status: row?.status ?? 'not_connected',
      problem: row?.problem ?? null,
      caught: messages.filter(m => m.thread === label).length,
      checkedAt: row?.lastPullAt?.toISOString() ?? null,
    };
  });
}
