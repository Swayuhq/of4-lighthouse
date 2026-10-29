import { draftReply, view } from '@/src/inbox';
import { customerCount } from '@/src/store/books';
import { load, loadThemes } from '@/src/store/db';
import { Inbox, type InboxData } from './inbox';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { ownerNames, messages, state } = await load();
  const v = view(state);
  // The books, not the screen, say how many customer messages exist. Missed is the gap between the two.
  const held = customerCount(ownerNames, messages);
  const shown = v.counts.answered + v.counts.waiting + v.counts.spam;
  const chatAuthors = [...new Set(messages.filter(m => m.platform === 'WhatsApp').map(m => m.author))];

  const data: InboxData = {
    items: v.items.map(i => ({ ...i, draft: draftReply(i, v.tone) })),
    todayIds: v.today.map(i => i.id),
    more: v.more,
    counts: { ...v.counts, arrived: held, missed: held - shown },
    askOwner: ownerNames.length === 0 && chatAuthors.length > 0 ? chatAuthors : [],
    empty: messages.length === 0,
    themes: await loadThemes(),
  };
  return <Inbox data={data} />;
}
