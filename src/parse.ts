// OF4 inbox prototype: turns uploaded files into one list of customer messages.
// Nothing is stored and nothing calls a model; the page holds the list while it is open.

export type InboxMessage = {
  /** Same file uploaded twice gives the same ids, so a message counts once. */
  id: string;
  platform: string;
  author: string;
  /** Local time as written in the file, YYYY-MM-DDTHH:MM, so text order is time order. */
  receivedAt: string;
  text: string;
  /** Review stars, 1 to 5, when the file gives them. */
  stars?: number;
};

export type ParseResult = {
  messages: InboxMessage[];
  /** Lines or rows that could not be read as a customer message. */
  skipped: number;
  /** Set when the whole file cannot be read, in words the owner understands. */
  problem?: string;
};

export type Inbox = { messages: InboxMessage[]; counts: Record<string, number> };

const pad = (n: number) => String(n).padStart(2, '0');

function localTime(day: number, month: number, year: number, hour: number, minute: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year;
  const check = new Date(Date.UTC(fullYear, month - 1, day, hour, minute));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return `${fullYear}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function to24Hour(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === 'pm';
  return (hour % 12) + (pm ? 12 : 0);
}

/** Gives each message an id from its content; the nth repeat inside one file gets #n so it stays separate. */
function withIds(drafts: Omit<InboxMessage, 'id'>[]): InboxMessage[] {
  const seen = new Map<string, number>();
  return drafts.map(draft => {
    const key = [draft.platform, draft.receivedAt, draft.author, draft.text].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { id: `${key}#${n}`, ...draft };
  });
}

// Android: "27/10/26, 4:23 pm - Name: text". iPhone: "[27/10/26, 4:23:10 PM] Name: text".
// Exports from India write the day first. A narrow space may sit before am or pm.
const WHATSAPP_LINE =
  /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s(\d{1,2}):(\d{2})(?::\d{2})?[\s\u202f]?([ap]m)?\]?(?:\s-\s|\s)(.*)$/i;

export function parseWhatsAppExport(fileText: string): ParseResult {
  const drafts: Omit<InboxMessage, 'id'>[] = [];
  let skipped = 0;
  let current: Omit<InboxMessage, 'id'> | null = null;

  for (const line of fileText.replace(/\r\n?/g, '\n').split('\n')) {
    const match = WHATSAPP_LINE.exec(line);
    if (!match) {
      if (current) current.text += `\n${line}`;
      else if (line.trim()) skipped += 1;
      continue;
    }
    const [, day, month, year, hour, minute, meridiem, rest = ''] = match;
    const receivedAt = localTime(Number(day), Number(month), Number(year), to24Hour(Number(hour), meridiem), Number(minute));
    const colon = rest.indexOf(': ');
    current = null;
    // A line with no "Name: " is a WhatsApp notice, such as the encryption notice, not a customer message.
    if (!receivedAt || colon < 1) {
      skipped += 1;
      continue;
    }
    current = { platform: 'WhatsApp', author: rest.slice(0, colon), receivedAt, text: rest.slice(colon + 2) };
    drafts.push(current);
  }
  return { messages: withIds(drafts), skipped };
}

/** Splits CSV text into rows, honouring quotes, doubled quotes and line breaks inside quotes. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim()));
}

/** Reads 2026-10-27, 2026-10-27 16:40 or 27/10/2026 (day first), with an optional time. */
function csvDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(value.trim());
  if (iso) return localTime(Number(iso[3]), Number(iso[2]), Number(iso[1]), Number(iso[4] ?? 0), Number(iso[5] ?? 0));
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s(\d{1,2}):(\d{2}))?/.exec(value.trim());
  if (dayFirst) return localTime(Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3]), Number(dayFirst[4] ?? 0), Number(dayFirst[5] ?? 0));
  return null;
}

const CSV_COLUMNS = ['platform', 'name', 'date', 'text'] as const;

export function parseCsv(fileText: string): ParseResult {
  const [header = [], ...rows] = csvRows(fileText);
  const index = new Map(header.map((cell, i) => [cell.trim().toLowerCase(), i]));
  const missing = CSV_COLUMNS.filter(column => !index.has(column));
  if (missing.length) {
    return {
      messages: [],
      skipped: rows.length,
      problem: `This file needs the columns platform, name, date and text. Missing: ${missing.join(', ')}.`,
    };
  }
  const cell = (row: string[], column: (typeof CSV_COLUMNS)[number] | 'stars') => (row[index.get(column)!] ?? '').trim();

  const drafts: Omit<InboxMessage, 'id'>[] = [];
  let skipped = 0;
  for (const row of rows) {
    const receivedAt = csvDate(cell(row, 'date'));
    const text = cell(row, 'text');
    const platform = cell(row, 'platform');
    if (!receivedAt || !text || !platform) {
      skipped += 1;
      continue;
    }
    const draft: Omit<InboxMessage, 'id'> = { platform, author: cell(row, 'name') || 'Unknown', receivedAt, text };
    const stars = index.has('stars') ? Number(cell(row, 'stars')) : NaN;
    if (Number.isInteger(stars) && stars >= 1 && stars <= 5) draft.stars = stars;
    drafts.push(draft);
  }
  return { messages: withIds(drafts), skipped };
}

/** One list across every upload: each message once, newest first, with a count per platform. */
export function buildInbox(uploads: InboxMessage[][]): Inbox {
  const byId = new Map<string, InboxMessage>();
  for (const message of uploads.flat()) byId.set(message.id, message);
  const messages = [...byId.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const counts: Record<string, number> = {};
  for (const message of messages) counts[message.platform] = (counts[message.platform] ?? 0) + 1;
  return { messages, counts };
}
