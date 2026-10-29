import { describe, expect, it } from 'vitest';
import { parseCsv, parseWhatsAppExport } from '../src/parse';
import { act, draftReply, emptyState, ingest, learnTone, view } from '../src/inbox';
import type { Facts } from '../src/facts';

const chat = [
  '26/10/26, 10:00 am - Tom: Hi, can I order 12 croissants for Tuesday?',
  '26/10/26, 10:05 am - Asha Bakes: Hi Tom! Yes, ready by 9 am 🙂 Asha',
  '28/10/26, 8:00 am - Tom: Order still not here. I need a refund.',
].join('\n');
const reviews = [
  'platform,name,date,text,stars',
  'Google review,Priya,2026-10-29 07:00,The cake arrived damaged.,1',
  'Google review,Mei,2026-10-29 09:00,Lovely staff.,5',
  'Instagram,Unknown,2026-10-29 09:30,You won a free phone tap here bit.ly/x,',
  'Instagram,Aisha,2026-10-29 03:00,Angry and terrible?,',
].join('\n');

function sample() {
  let state = ingest(emptyState(), parseWhatsAppExport(chat).messages, 'chat-tom');
  state = ingest(state, parseCsv(reviews).messages, 'reviews');
  return { ...state, ownerNames: ['Asha Bakes'] };
}

describe('view', () => {
  it('leaves the owner out and starts a message the owner replied to as answered', () => {
    const items = view(sample()).items;
    expect(items.some(i => i.author === 'Asha Bakes')).toBe(false);
    expect(items.find(i => i.text.startsWith('Hi, can I'))!.status).toBe('answered');
  });

  it('puts the most urgent first and says why in words, from facts only', () => {
    const waiting = view(sample()).items.filter(i => i.status === 'waiting');
    expect(waiting.map(i => i.author)).toEqual(['Tom', 'Priya', 'Aisha', 'Mei']);
    expect(waiting[0].reasons).toEqual(['says refund', 'waiting 25 hours', 'wrote before']);
    expect(waiting[1].reasons).toEqual(['1 star', 'says damaged']);
  });

  it('gives mood words no points', () => {
    const aisha = view(sample()).items.find(i => i.author === 'Aisha')!;
    expect(aisha.reasons).toEqual(['waiting 6 hours']);
  });

  it('sets a link with a prize aside as spam, still counted', () => {
    const v = view(sample());
    expect(v.items.find(i => i.author === 'Unknown')!.status).toBe('spam');
    expect(v.counts).toEqual({ arrived: 6, answered: 1, waiting: 4, spam: 1, missed: 0 });
  });

  it('shows the top three waiting as Today and how many more wait', () => {
    const v = view(sample());
    expect(v.today.map(i => i.author)).toEqual(['Tom', 'Priya', 'Aisha']);
    expect(v.more).toBe(1);
  });

  it('counts a message once when the same file arrives twice', () => {
    const twice = ingest(sample(), parseCsv(reviews).messages, 'reviews');
    expect(view(twice).counts.arrived).toBe(6);
  });
});

describe('learnTone and draftReply', () => {
  it('learns the greeting, the sign off and the emoji from the owner\'s own lines', () => {
    expect(learnTone(['Hi Tom! Yes, ready by 9 am 🙂 Asha', 'Hi Ravi, done 🙂 Asha'])).toEqual({ greeting: 'Hi', signOff: 'Asha', emoji: '🙂' });
  });

  it('falls back to a plain tone when the owner has written nothing', () => {
    expect(learnTone([])).toEqual({ greeting: 'Hi', signOff: '', emoji: '' });
  });

  it('drafts an apology for a complaint without inventing facts', () => {
    const tom = view(sample()).today[0];
    expect(draftReply(tom, { greeting: 'Hi', signOff: 'Asha', emoji: '🙂' }))
      .toBe("Hi Tom, I am sorry about this. I will look into it today and make it right. Asha");
  });

  it('thanks praise and adds the owner\'s emoji', () => {
    const mei = view(sample()).items.find(i => i.author === 'Mei')!;
    expect(draftReply(mei, { greeting: 'Hello', signOff: '', emoji: '🙂' }))
      .toBe('Hello Mei, thank you so much! We are glad you enjoyed it. See you again soon 🙂');
  });

  it('promises to check a question instead of guessing the answer', () => {
    const q = { ...view(sample()).items.find(i => i.author === 'Mei')!, text: 'Do you deliver on Sunday?', stars: undefined };
    expect(draftReply(q, { greeting: 'Hi', signOff: '', emoji: '' }))
      .toBe('Hi Mei, thanks for asking. Let me check and get back to you shortly.');
  });
});

describe('act', () => {
  it('sends an approved reply, marks it answered and keeps the counts whole', () => {
    const tom = view(sample()).today[0];
    const after = act(sample(), tom.id, 'send', 'Sorry Tom, refund sent today.');
    const v = view(after);
    expect(v.items.find(i => i.id === tom.id)!.reply).toBe('Sorry Tom, refund sent today.');
    expect(v.counts).toEqual({ arrived: 6, answered: 2, waiting: 3, spam: 1, missed: 0 });
    expect(v.today.map(i => i.author)).toEqual(['Priya', 'Aisha', 'Mei']);
  });

  it('brings spam back and undoes an answer', () => {
    const spam = view(sample()).items.find(i => i.author === 'Unknown')!;
    let state = act(sample(), spam.id, 'waiting');
    expect(view(state).counts.spam).toBe(0);
    state = act(state, spam.id, 'answered');
    state = act(state, spam.id, 'waiting');
    expect(view(state).counts).toEqual({ arrived: 6, answered: 1, waiting: 5, spam: 0, missed: 0 });
  });
});

describe('view with the reader facts', () => {
  const facts = (f: Partial<Facts>): Facts => ({ kind: 'other', problem: 'none', asks: null, deadline: null, ...f });
  const withFacts = (pick: (text: string) => Partial<Facts> | null) => {
    const state = sample();
    const found: Record<string, Facts> = {};
    for (const m of state.messages) {
      const f = pick(m.text);
      if (f) found[m.id] = facts(f);
    }
    return view({ ...state, facts: found });
  };

  it('a complaint with no keyword still ranks, with the reason in words', () => {
    const item = withFacts(t => (t.startsWith('Angry') ? { kind: 'complaint', problem: 'refund' } : null)).items.find(i => i.author === 'Aisha')!;
    expect(item.reasons).toContain('wants a refund');
    expect(item.points).toBeGreaterThanOrEqual(3);
  });

  it('a deadline the customer gave adds a point and says when', () => {
    const item = withFacts(t => (t.startsWith('Lovely') ? { kind: 'order', deadline: 'Friday' } : null)).items.find(i => i.author === 'Mei')!;
    expect(item.reasons).toContain('needs it by Friday');
  });

  it('the reader can call a polite message spam, and can clear one the keyword rule caught', () => {
    const items = withFacts(t => (t.startsWith('Lovely') ? { kind: 'spam' } : t.startsWith('You won') ? { kind: 'question' } : null)).items;
    expect(items.find(i => i.author === 'Mei')!.status).toBe('spam');
    expect(items.find(i => i.text.startsWith('You won'))!.status).toBe('waiting');
  });

  it('praise from the reader adds no problem points, even when the words sound angry', () => {
    const item = withFacts(t => (t.startsWith('Angry') ? { kind: 'praise' } : null)).items.find(i => i.author === 'Aisha')!;
    expect(item.reasons.some(r => /refund|complaint|damaged/.test(r))).toBe(false);
  });

  it('counts still add up when the reader moved messages to spam', () => {
    const { counts } = withFacts(t => (t.startsWith('Lovely') ? { kind: 'spam' } : null));
    expect(counts.arrived).toBe(counts.answered + counts.waiting + counts.spam);
  });
});
