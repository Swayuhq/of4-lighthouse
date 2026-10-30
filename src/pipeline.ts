// The data pipeline: a channel brings comments, they are stored once, then the agents read what is new.
// The screen and the API routes both call these, so there is one path from a channel to the agents.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS, pullSample, toMessages, type Channel } from './connectors';
import { connections, load, saveFacts, saveThemes, storeFromChannel, unread } from './store/db';
import { agentsOn } from './agents/model';
import { readAll } from './agents/reader';
import { findThemes } from './agents/insights';

/** Runs the reader on every message it has not labelled. With no key set, the keyword rules do the job alone. */
export async function readNew() {
  if (!agentsOn()) return;
  const fresh = await unread();
  if (!fresh.length) return;
  await saveFacts(await readAll(fresh), 'gemini-3.1-flash-lite');
  // New messages can change what customers keep saying, so the themes are found again.
  const { ownerNames, state } = await load();
  const owners = new Set(ownerNames);
  await saveThemes(await findThemes(state.messages.filter(m => !owners.has(m.author))));
}

export type PullResult = { channel: Channel; added: number; refused: number; left: number };

/** Brings the next comments from one connected channel. Live channels ask the platform; sample channels read their saved feed. */
export async function pull(channel: Channel, take = 1): Promise<PullResult> {
  const conn = (await connections()).find(c => c.channel === channel);
  if (!conn || conn.status !== 'connected') throw new Error(`${ADAPTERS[channel].label} is not connected`);
  const { fetch } = ADAPTERS[channel];
  if (fetch) {
    const { messages, refused } = toMessages(channel, await fetch());
    const added = await storeFromChannel(channel, messages, conn.cursor);
    if (added) await readNew();
    return { channel, added, refused, left: 0 };
  }
  const feed: unknown[] = JSON.parse(await readFile(join(process.cwd(), 'samples', 'channels', `${channel}.json`), 'utf8'));
  const next = pullSample(feed, conn.cursor, take);
  const { messages, refused } = toMessages(channel, next.items);
  const added = await storeFromChannel(channel, messages, next.cursor);
  if (added) await readNew();
  return { channel, added, refused, left: feed.length - next.cursor };
}
