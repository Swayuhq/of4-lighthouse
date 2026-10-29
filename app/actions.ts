'use server';
// Every owner button lands here. Each one writes to the books, then the page reads them again.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCsv, parseWhatsAppExport, type ParseResult } from '@/src/parse';
import { checkMessages } from '@/src/message';
import { connect, connections, load, markBroken, nameBusiness, record, setOwnerNames, startOver, store } from '@/src/store/db';
import { agentsOn } from '@/src/agents/model';
import { pull, readNew } from '@/src/pipeline';
import { ADAPTERS, isChannel } from '@/src/connectors';
import { writeReply } from '@/src/agents/reply';

function read(name: string, text: string): ParseResult {
  if (/\.txt$/i.test(name)) return parseWhatsAppExport(text);
  if (/\.csv$/i.test(name)) return parseCsv(text);
  return { messages: [], skipped: 0, problem: 'Add a WhatsApp chat export (.txt) or a reviews file (.csv).' };
}

export type AddResult = { file: string; added: number; problem?: string };

/** One file from the owner. Returns how many new messages it brought, or one plain sentence on what is wrong. */
export async function addFile(name: string, text: string): Promise<AddResult> {
  if (text.length > 5_000_000) return { file: name, added: 0, problem: 'This file is too large. Export a shorter chat and try again.' };
  const parsed = read(name, text);
  if (parsed.problem) return { file: name, added: 0, problem: parsed.problem };
  const checked = checkMessages(parsed.messages);
  if (!checked.messages.length) return { file: name, added: 0, problem: 'No messages were found in this file.' };
  const added = await store(checked.messages, name);
  await readNew();
  revalidatePath('/', 'layout');
  return { file: name, added };
}

/** Sign up: the business gets its name, then the owner picks channels. */
export async function startBusiness(form: FormData) {
  const name = String(form.get('business') ?? '').trim().slice(0, 80);
  if (!name) return;
  await nameBusiness(name);
  redirect('/connect');
}

/** Connects one channel and brings everything it already holds. */
export async function connectChannel(channel: string): Promise<{ added: number; refused: number; problem?: string }> {
  if (!isChannel(channel)) return { added: 0, refused: 0, problem: 'Swayu cannot connect that channel yet.' };
  await connect(channel);
  const { added, refused } = await pull(channel, 1000);
  revalidatePath('/', 'layout');
  return { added, refused };
}

/** One check of every connected channel. A channel that fails is marked broken, so its count reads unknown. */
export async function checkChannels(): Promise<{ added: number }> {
  let added = 0;
  for (const c of await connections()) {
    if (c.status !== 'connected') continue;
    try {
      added += (await pull(c.channel, 50)).added;
    } catch {
      await markBroken(c.channel, `Swayu could not reach ${ADAPTERS[c.channel].label}. Connect it again.`);
    }
  }
  revalidatePath('/', 'layout');
  return { added };
}

export async function chooseOwner(names: string[]) {
  await setOwnerNames(names);
  revalidatePath('/', 'layout');
}

export async function markAs(id: string, status: 'waiting' | 'answered' | 'spam') {
  await record(id, status);
  revalidatePath('/', 'layout');
}

export async function sendReply(id: string, text: string) {
  await record(id, 'sent', text.trim());
  revalidatePath('/', 'layout');
}

/** A draft in the owner's voice for one message, or null so the screen keeps the fixed draft. */
export async function draftFor(id: string): Promise<string | null> {
  if (!agentsOn()) return null;
  const { ownerNames, state } = await load();
  const m = state.messages.find(x => x.id === id);
  if (!m) return null;
  const owners = new Set(ownerNames);
  const ownerLines = state.messages.filter(x => owners.has(x.author)).map(x => x.text);
  return writeReply(m, ownerLines, state.facts[id]);
}

export async function clearAll() {
  await startOver();
  redirect('/');
}
