// Sign up, step two: the owner connects the channels customers already write on.
import { redirect } from 'next/navigation';
import { businessName, load } from '@/src/store/db';
import { channelViews } from '../channels';
import { Steps, Wordmark } from '../brand';
import { ChannelList } from './channel-list';

export const dynamic = 'force-dynamic';

export default async function Connect() {
  const name = await businessName();
  if (!name) redirect('/start');
  const { messages } = await load();
  const channels = await channelViews(messages);

  return (
    <div className="mx-auto max-w-[44rem] px-4 pb-24 pt-6 sm:px-6">
      <header><Wordmark business={name} /></header>
      <div className="mt-12"><Steps at={1} /></div>
      <h1 className="mt-10 text-[2.2rem] font-bold leading-tight">Where do your customers write to you?</h1>
      <p className="mt-2 text-lg text-navy-soft">Connect each one. Lighthouse checks them for new messages on its own.</p>
      <ChannelList channels={channels} />
    </div>
  );
}
