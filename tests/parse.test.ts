import { describe, expect, it } from 'vitest';
import { buildInbox, parseCsv, parseWhatsAppExport } from '../src/parse';

describe('parseWhatsAppExport', () => {
  it('reads Android lines with a day first date and am or pm', () => {
    const { messages, skipped } = parseWhatsAppExport(
      '27/10/26, 4:23 pm - Priya: Is the eggless cake available?\n27/10/26, 4:25 pm - Asha Sweets: Yes, from 11 am.',
    );
    expect(skipped).toBe(0);
    expect(messages.map(m => [m.author, m.receivedAt, m.text])).toEqual([
      ['Priya', '2026-10-27T16:23', 'Is the eggless cake available?'],
      ['Asha Sweets', '2026-10-27T16:25', 'Yes, from 11 am.'],
    ]);
    expect(messages[0].platform).toBe('WhatsApp');
  });

  it('reads iPhone lines in brackets with seconds and a narrow space before PM', () => {
    const { messages } = parseWhatsAppExport('[05/11/2026, 12:05:09 AM] Ravi: Hello');
    expect(messages[0]).toMatchObject({ author: 'Ravi', receivedAt: '2026-11-05T00:05', text: 'Hello' });
  });

  it('joins a message written over several lines', () => {
    const { messages } = parseWhatsAppExport('27/10/26, 16:23 - Priya: First line\nsecond line');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('First line\nsecond line');
  });

  it('skips WhatsApp notices that have no sender', () => {
    const { messages, skipped } = parseWhatsAppExport(
      '27/10/26, 4:20 pm - Messages and calls are end-to-end encrypted.\n27/10/26, 4:23 pm - Priya: Hi',
    );
    expect(messages.map(m => m.text)).toEqual(['Hi']);
    expect(skipped).toBe(1);
  });

  it('keeps two identical messages in one file as two messages', () => {
    const { messages } = parseWhatsAppExport('27/10/26, 4:23 pm - Priya: ok\n27/10/26, 4:23 pm - Priya: ok');
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map(m => m.id)).size).toBe(2);
  });

  it('returns nothing for an empty file', () => {
    expect(parseWhatsAppExport('')).toEqual({ messages: [], skipped: 0 });
  });
});

describe('parseCsv', () => {
  it('reads platform, name, date and text in any column order and case', () => {
    const { messages, skipped } = parseCsv('Text,Date,Name,Platform\nGreat sweets,2026-10-26 18:40,Meena,Google review');
    expect(skipped).toBe(0);
    expect(messages[0]).toMatchObject({
      platform: 'Google review', author: 'Meena', receivedAt: '2026-10-26T18:40', text: 'Great sweets',
    });
  });

  it('reads quoted fields with commas, quotes and line breaks', () => {
    const { messages } = parseCsv('platform,name,date,text\nInstagram,Ravi,27/10/2026,"Loved it, ""really""\nwill come again"');
    expect(messages[0].text).toBe('Loved it, "really"\nwill come again');
    expect(messages[0].receivedAt).toBe('2026-10-27T00:00');
  });

  it('counts rows with a bad date or no text as skipped', () => {
    const { messages, skipped } = parseCsv('platform,name,date,text\nYouTube,A,yesterday,Hi\nYouTube,B,2026-10-27,\nYouTube,C,2026-10-27,Nice');
    expect(messages.map(m => m.author)).toEqual(['C']);
    expect(skipped).toBe(2);
  });

  it('reads an optional stars column, and leaves it out when empty or not 1 to 5', () => {
    const { messages } = parseCsv('platform,name,date,text,stars\nGoogle review,Priya,2026-10-27,Damaged,1\nGoogle review,Mei,2026-10-27,Lovely,\nGoogle review,Kwame,2026-10-27,Ok,9');
    expect(messages.map(m => m.stars)).toEqual([1, undefined, undefined]);
  });

  it('names the missing columns instead of reading a file without them', () => {
    const result = parseCsv('who,when\nA,2026-10-27');
    expect(result.messages).toEqual([]);
    expect(result.problem).toBe('This file needs the columns platform, name, date and text. Missing: platform, name, date, text.');
  });
});

describe('buildInbox', () => {
  const file = '27/10/26, 4:23 pm - Priya: Hi\n27/10/26, 5:00 pm - Ravi: Price?';

  it('counts a message once when the same file is uploaded twice', () => {
    const inbox = buildInbox([parseWhatsAppExport(file).messages, parseWhatsAppExport(file).messages]);
    expect(inbox.messages).toHaveLength(2);
    expect(inbox.counts).toEqual({ WhatsApp: 2 });
  });

  it('puts the newest message first across platforms and counts each platform', () => {
    const csv = parseCsv('platform,name,date,text\nGoogle review,Meena,2026-10-27 16:40,Lovely');
    const inbox = buildInbox([parseWhatsAppExport(file).messages, csv.messages]);
    expect(inbox.messages.map(m => m.author)).toEqual(['Ravi', 'Meena', 'Priya']);
    expect(inbox.counts).toEqual({ WhatsApp: 2, 'Google review': 1 });
  });
});
