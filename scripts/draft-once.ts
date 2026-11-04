// Runs one drafting pass on the real model against the inbox, then prints what was kept. Nothing is sent.
// Run with: sh scripts/draft-once.sh [channel ...]
import { draftNow } from '../src/drafting';
import { connect, load } from '../src/store/db';
import { view } from '../src/inbox';
import { pull } from '../src/pipeline';
import { isChannel } from '../src/connectors';

// Channels named on the command line are connected and read first, the same as the owner's Connect button.
for (const channel of process.argv.slice(2).filter(isChannel)) {
  await connect(channel);
  console.log(channel, await pull(channel, 1000));
}
await draftNow();
const items = view((await load()).state).items.filter(i => i.status === 'waiting');
console.log(JSON.stringify(items.map(i => ({ author: i.author, message: i.text.slice(0, 60), draft: i.heldReply ?? null })), null, 1));
process.exit(0);
