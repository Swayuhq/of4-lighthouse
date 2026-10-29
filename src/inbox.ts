// OF4 inbox prototype: what Swayu decides about each customer message.
// Pure functions over one state object, so the page and the tests share every rule.
import type { InboxMessage } from './parse';
import { PROBLEM_REASON, type Facts } from './facts';

export type Status = 'waiting' | 'answered' | 'spam';
export type Tone = { greeting: string; signOff: string; emoji: string };
export type Counts = { arrived: number; answered: number; waiting: number; spam: number; missed: number };

export type State = {
  /** Every message read, the owner's own included, each once by id. */
  messages: InboxMessage[];
  /** The conversation each message came from: one chat export, one reviews file, one watched profile. */
  thread: Record<string, string>;
  /** Which author names are the owner. Their lines teach the tone and are never counted. */
  ownerNames: string[];
  /** What the owner did. Anything not here gets Swayu's first guess. */
  status: Record<string, Status>;
  reply: Record<string, string>;
  /** What the reader agent found. A message without facts is judged by the keyword rules instead. */
  facts: Record<string, Facts>;
};

export type Item = InboxMessage & { status: Status; points: number; reasons: string[]; reply?: string; facts?: Facts };

export type View = { items: Item[]; today: Item[]; more: number; counts: Counts; tone: Tone };

export const emptyState = (): State => ({ messages: [], thread: {}, ownerNames: [], status: {}, reply: {}, facts: {} });

/** Adds messages from one source. A message already read is skipped, so loading a file twice changes nothing. */
export function ingest(state: State, messages: InboxMessage[], thread: string): State {
  const known = new Set(state.messages.map(m => m.id));
  const fresh = messages.filter(m => !known.has(m.id));
  const threads = { ...state.thread };
  for (const m of fresh) threads[m.id] = thread;
  return { ...state, messages: [...state.messages, ...fresh], thread: threads };
}

export function act(state: State, id: string, action: 'send' | Status, text = ''): State {
  if (action === 'send') {
    return { ...state, status: { ...state.status, [id]: 'answered' }, reply: { ...state.reply, [id]: text } };
  }
  const reply = { ...state.reply };
  if (action !== 'answered') delete reply[id];
  return { ...state, status: { ...state.status, [id]: action }, reply };
}

// Urgency comes from facts the owner can check, never from mood (Harish, 14 October).
// The points live here, in one place, so they are easy to change.
const PROBLEM_WORDS = ['refund', 'money back', 'not delivered', 'not here', 'damaged', 'wrong item', 'cancel'];
const POINTS = { lowStars: 3, problemWords: 3, waitingOverDay: 2, waitingHours: 1, wroteBefore: 1, deadline: 1 };

const LINK = /https?:\/\/|www\.|bit\.ly|tap here|click here/i;
const PRIZE = /\b(won|winner|prize|free|lottery|crypto)\b/i;

const minutes = (localTime: string) => Date.parse(localTime + 'Z') / 60000;

function score(m: InboxMessage, now: string, wroteBefore: boolean, facts?: Facts) {
  const reasons: string[] = [];
  let points = 0;
  if (m.stars !== undefined && m.stars <= 2) {
    points += POINTS.lowStars;
    reasons.push(m.stars === 1 ? '1 star' : `${m.stars} stars`);
  }
  if (facts) {
    // The reader understood the message, so its facts replace the keyword list.
    const problem = facts.problem !== 'none' ? PROBLEM_REASON[facts.problem] : facts.kind === 'complaint' ? PROBLEM_REASON.other : null;
    if (problem) {
      points += POINTS.problemWords;
      reasons.push(problem);
    }
    if (facts.deadline) {
      points += POINTS.deadline;
      reasons.push(`needs it ${/^(by|on|for|before)\b/i.test(facts.deadline) ? '' : 'by '}${facts.deadline}`);
    }
  } else {
    const word = PROBLEM_WORDS.find(w => m.text.toLowerCase().includes(w));
    if (word) {
      points += POINTS.problemWords;
      reasons.push(`says ${word}`);
    }
  }
  const hours = Math.floor((minutes(now) - minutes(m.receivedAt)) / 60);
  if (hours > 24) points += POINTS.waitingOverDay;
  else if (hours >= 4) points += POINTS.waitingHours;
  if (hours >= 4) reasons.push(`waiting ${hours} hours`);
  if (wroteBefore) {
    points += POINTS.wroteBefore;
    reasons.push('wrote before');
  }
  return { points, reasons };
}

export function view(state: State): View {
  const owners = new Set(state.ownerNames);
  const all = [...state.messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  // "Now" is the newest message, not the clock, so an old export does not show 700 hours waiting.
  const now = all.at(-1)?.receivedAt ?? '';
  const seenAuthors = new Set<string>();
  const items: Item[] = [];
  for (const m of all) {
    if (owners.has(m.author)) continue;
    const ownerReplied = all.some(o => owners.has(o.author) && state.thread[o.id] === state.thread[m.id] && o.receivedAt > m.receivedAt);
    const facts = state.facts[m.id];
    const looksSpam = facts ? facts.kind === 'spam' : LINK.test(m.text) && PRIZE.test(m.text);
    const guess: Status = ownerReplied ? 'answered' : looksSpam ? 'spam' : 'waiting';
    const wroteBefore = m.author !== 'Unknown' && seenAuthors.has(m.author);
    seenAuthors.add(m.author);
    items.push({ ...m, status: state.status[m.id] ?? guess, ...score(m, now, wroteBefore, facts), reply: state.reply[m.id], facts });
  }
  // Most points first; equal points, the one waiting longer first.
  items.sort((a, b) => b.points - a.points || a.receivedAt.localeCompare(b.receivedAt));
  const waiting = items.filter(i => i.status === 'waiting');
  const counts: Counts = {
    arrived: items.length,
    answered: items.filter(i => i.status === 'answered').length,
    waiting: waiting.length,
    spam: items.filter(i => i.status === 'spam').length,
    missed: 0,
  };
  counts.missed = counts.arrived - counts.answered - counts.waiting - counts.spam;
  const tone = learnTone(all.filter(m => owners.has(m.author)).map(m => m.text));
  return { items, today: waiting.slice(0, 3), more: Math.max(0, waiting.length - 3), counts, tone };
}

const GREETINGS = ['hi', 'hello', 'hey', 'namaste', 'dear', 'hola'];
const EMOJI = /\p{Extended_Pictographic}/u;

function mostCommon(values: string[]): [string, number] {
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
}

/** Learns how the owner writes from their own past replies. A habit counts once it shows in half the lines. */
export function learnTone(ownerLines: string[]): Tone {
  const half = Math.max(2, ownerLines.length / 2);
  const firstWords = ownerLines.map(l => l.trim().split(/[\s,!]+/)[0] ?? '');
  const [greeting] = mostCommon(firstWords.filter(w => GREETINGS.includes(w.toLowerCase())));
  const [signOff, signCount] = mostCommon(ownerLines.map(l => l.trim().split(/\s+/).at(-1) ?? '').filter(w => /^\p{Lu}\p{Ll}+$/u.test(w)));
  const [emoji, emojiCount] = mostCommon(ownerLines.map(l => l.match(EMOJI)?.[0] ?? '').filter(Boolean));
  return {
    greeting: greeting || 'Hi',
    signOff: signCount >= half ? signOff : '',
    emoji: emojiCount >= half ? emoji : '',
  };
}

/**
 * A first draft in the owner's tone. It never states a fact the owner did not give,
 * so a question gets a promise to check. A model can replace this function later.
 */
export function draftReply(m: Item, tone: Tone): string {
  const name = m.author === 'Unknown' ? '' : ` ${m.author.split(' ')[0]}`;
  const hello = `${tone.greeting}${name},`;
  const complaint = (m.stars !== undefined && m.stars <= 2) || PROBLEM_WORDS.some(w => m.text.toLowerCase().includes(w));
  let body: string;
  if (complaint) body = 'I am sorry about this. I will look into it today and make it right.';
  else if (m.text.includes('?')) body = 'thanks for asking. Let me check and get back to you shortly.';
  else body = `thank you so much! We are glad you enjoyed it. See you again soon${tone.emoji ? ' ' + tone.emoji : '.'}`;
  return [hello, body, tone.signOff].filter(Boolean).join(' ');
}
