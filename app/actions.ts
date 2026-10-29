'use server';
// Every owner button lands here. Each one writes to the books, then the page reads them again.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';
import { parseCsv, parseWhatsAppExport, type ParseResult } from '@/src/parse';
import { checkMessages } from '@/src/message';
import { load, record, saveFacts, saveThemes, setOwnerNames, startOver, store, storedIds, unread } from '@/src/store/db';
import { agentsOn } from '@/src/agents/model';
import { readAll } from '@/src/agents/reader';
import { writeReply } from '@/src/agents/reply';
import { findThemes } from '@/src/agents/insights';

const SAMPLE_FILES = ['whatsapp-tom.txt', 'whatsapp-aisha.txt', 'reviews.csv'];
const sample = (name: string) => readFile(join(process.cwd(), 'samples', name), 'utf8');

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
  revalidatePath('/');
  return { file: name, added };
}

export async function loadSampleBakery() {
  for (const name of SAMPLE_FILES) await addFile(name, await sample(name));
}

export async function chooseOwner(names: string[]) {
  await setOwnerNames(names);
  revalidatePath('/');
}

export async function markAs(id: string, status: 'waiting' | 'answered' | 'spam') {
  await record(id, status);
  revalidatePath('/');
}

export async function sendReply(id: string, text: string) {
  await record(id, 'sent', text.trim());
  revalidatePath('/');
}

/** The simulated watcher: brings in the next comment from the watched profiles, if one is left. */
export async function watchOnce(): Promise<{ arrived: string | null }> {
  const queue = checkMessages(parseCsv(await sample('watch.csv')).messages).messages;
  const known = await storedIds(queue.map(m => m.id));
  const next = queue.find(m => !known.has(m.id));
  if (!next) return { arrived: null };
  await store([next], `watch-${next.platform}`);
  await readNew();
  revalidatePath('/');
  return { arrived: `${next.author === 'Unknown' ? 'Someone' : next.author} on ${next.platform}` };
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

/** Runs the reader on every message it has not labelled. With no key set, the keyword rules do the job alone. */
async function readNew() {
  if (!agentsOn()) return;
  const fresh = await unread();
  if (!fresh.length) return;
  await saveFacts(await readAll(fresh), 'gpt-5-nano');
  // New messages can change what customers keep saying, so the themes are found again.
  const { ownerNames, state } = await load();
  const owners = new Set(ownerNames);
  await saveThemes(await findThemes(state.messages.filter(m => !owners.has(m.author))));
}

export async function clearAll() {
  await startOver();
  revalidatePath('/');
}
