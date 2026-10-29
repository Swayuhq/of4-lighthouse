import { draftReply, view } from '@/src/inbox';
import { customerCount, liveThemes } from '@/src/store/books';
import { redirect } from 'next/navigation';
import { load, loadThemes } from '@/src/store/db';
import { channelViews } from '../channels';
import { Inbox, type InboxData } from './inbox';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { businessName, ownerNames, messages, state } = await load();
  if (!businessName) redirect('/start');
  const v = view(state);
  // The books, not the screen, say how many customer messages exist. Missed is the gap between the two.
  const held = customerCount(ownerNames, messages);
  const shown = v.counts.answered + v.counts.waiting + v.counts.spam;
  // Only an exported chat holds the owner's own lines. A connected WhatsApp number brings customers alone.
  const chatAuthors = [...new Set(messages.filter(m => m.platform === 'WhatsApp' && m.thread !== 'WhatsApp').map(m => m.author))];

  const data: InboxData = {
    items: v.items.map(i => ({ ...i, draft: draftReply(i, v.tone) })),
    todayIds: v.today.map(i => i.id),
    more: v.more,
    counts: { ...v.counts, arrived: held, missed: held - shown },
    askOwner: ownerNames.length === 0 && chatAuthors.length > 0 ? chatAuthors : [],
    empty: messages.length === 0,
    themes: liveThemes(await loadThemes(), new Set(messages.map(m => m.contentId))),
    business: businessName,
    channels: await channelViews(messages),
  };
  return <Inbox data={data} />;
}
