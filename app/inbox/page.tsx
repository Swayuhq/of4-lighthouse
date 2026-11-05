import { draftReply, view } from '@/src/inbox';
import { customerCount, liveThemes } from '@/src/store/books';
import { redirect } from 'next/navigation';
import { load, loadThemes, sweepHistory } from '@/src/store/db';
import { channelViews } from '../channels';
import { Inbox, type InboxData } from './inbox';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // The sweep runs before every look, so the owner never sees text past its 30 days.
  await sweepHistory();
  const { businessName, ownerNames, messages, state } = await load();
  if (!businessName) redirect('/start');
  const v = view(state);
  // The books, not the screen, say how many customer messages exist. Missed is the gap between the two.
  const held = customerCount(ownerNames, messages);
  const shown = v.counts.answered + v.counts.waiting + v.counts.spam;
  // Only an exported chat holds the owner's own lines. A connected WhatsApp number brings customers alone.
  const chatAuthors = [...new Set(messages.filter(m => m.platform === 'WhatsApp' && m.thread !== 'WhatsApp').map(m => m.author))];

  const data: InboxData = {
    items: v.items.map(i => ({ ...i, draft: i.heldReply ?? draftReply(i, v.tone) })),
    todayIds: v.today.map(i => i.id),
    more: v.more,
    counts: { ...v.counts, arrived: held, missed: held - shown },
    askOwner: ownerNames.length === 0 && chatAuthors.length > 0 ? chatAuthors : [],
    empty: messages.length === 0,
    themes: liveThemes(await loadThemes(), new Set(messages.map(m => m.contentId))),
    business: businessName,
    channels: await channelViews(messages),
    // The webhook refuses every push until its secret is set, so the secret is what turns push on.
    pushOn: Boolean(process.env.SWAYU_ZERNIO_WEBHOOK_SECRET),
  };
  return <Inbox data={data} />;
}
