'use client';
// The owner's one screen: the tally, Today's 3, then everything else.
import { useEffect, useRef, useState, useTransition } from 'react';
import type { Counts, Item, Status } from '@/src/inbox';
import { addFile, chooseOwner, clearAll, draftFor, markAs, sendReply, loadSampleBakery, watchOnce, type AddResult } from './actions';

export type InboxItem = Item & { draft: string };
import type { Theme } from '@/src/agents/insights';

export type InboxData = {
  items: InboxItem[];
  todayIds: string[];
  more: number;
  counts: Counts;
  askOwner: string[];
  empty: boolean;
  themes: Theme[];
};

type Toast = { text: string; undo?: { id: string; status: Status } };

const STATUS_COLOR: Record<Status, string> = { answered: 'bg-kelp', waiting: 'bg-lamp', spam: 'bg-slate' };
const DONE_WORD: Record<Status, string> = { answered: 'Marked answered', waiting: 'Back in waiting', spam: 'Moved to spam' };

function when(receivedAt: string) {
  const [date, time] = receivedAt.split('T');
  const [, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h12 = hour % 12 || 12;
  return `${day} ${months[month - 1]}, ${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

export function Inbox({ data }: { data: InboxData }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [watching, setWatching] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Status>('waiting');
  const known = useRef<Set<string>>(new Set(data.items.map(i => i.id)));

  // A message the owner has not seen on this screen yet gets the beam once.
  useEffect(() => {
    const arrivals = data.items.filter(i => !known.current.has(i.id)).map(i => i.id);
    data.items.forEach(i => known.current.add(i.id));
    // A whole file at once is not news; the beam is for a few messages arriving while the owner watches.
    if (!arrivals.length || arrivals.length > 3) return;
    setFresh(new Set(arrivals));
    const t = setTimeout(() => setFresh(new Set()), 3000);
    return () => clearTimeout(t);
  }, [data.items]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(async () => {
      const { arrived } = await watchOnce();
      if (arrived) setToast({ text: `New message from ${arrived}` });
      else {
        setWatching(false);
        setToast({ text: 'All caught up. No new messages on your profiles.' });
      }
    }, 3500);
    return () => clearInterval(timer);
  }, [watching]);

  function act(item: InboxItem, status: Status) {
    start(async () => {
      await markAs(item.id, status);
      setToast({ text: DONE_WORD[status], undo: { id: item.id, status: item.status } });
    });
  }

  function send(item: InboxItem, text: string) {
    start(async () => {
      await sendReply(item.id, text);
      setToast({ text: `Reply saved for ${item.author === 'Unknown' ? 'this customer' : item.author}`, undo: { id: item.id, status: item.status } });
    });
  }

  function undo(u: { id: string; status: Status }) {
    start(async () => {
      await markAs(u.id, u.status);
      setToast(null);
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const results: AddResult[] = [];
    for (const file of Array.from(files)) results.push(await addFile(file.name, await file.text()));
    setProblems(results.filter(r => r.problem).map(r => `${r.file}: ${r.problem}`));
    const added = results.reduce((n, r) => n + r.added, 0);
    if (added) setToast({ text: `${added} new message${added === 1 ? '' : 's'} added` });
    else if (results.every(r => !r.problem)) setToast({ text: 'Nothing new. These messages are already here.' });
  }

  const today = data.todayIds.map(id => data.items.find(i => i.id === id)!).filter(Boolean);
  const listed = data.items.filter(i => i.status === tab && !(tab === 'waiting' && data.todayIds.includes(i.id)));

  return (
    <div className="mx-auto max-w-[44rem] px-4 pb-32 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Wordmark />
        <div className="ml-auto flex items-center gap-2">
          {!data.empty && (
            <button
              onClick={() => setWatching(w => !w)}
              aria-pressed={watching}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${watching ? 'border-navy bg-navy text-white' : 'border-shore bg-white'}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${watching ? 'watching-dot bg-lamp' : 'bg-slate'}`} />
              {watching ? 'Watching your profiles' : 'Watch my profiles'}
            </button>
          )}
          {!data.empty && <FileButton onFiles={onFiles} quiet />}
        </div>
      </header>

      {problems.length > 0 && (
        <div role="alert" className="mt-5 rounded-lg border border-alarm/30 bg-white p-4 text-sm">
          {problems.map(p => <p key={p}>{p}</p>)}
        </div>
      )}

      {data.empty ? (
        <Welcome onFiles={onFiles} onSample={() => start(() => loadSampleBakery())} busy={pending} />
      ) : (
        <>
          {data.askOwner.length > 0 && <WhichNameIsYou names={data.askOwner} />}
          <Tally counts={data.counts} items={data.items} />

          <section className="mt-10" aria-labelledby="today">
            <div className="flex items-baseline justify-between">
              <h2 id="today" className="text-2xl font-bold">Today&apos;s 3</h2>
              {data.more > 0 && <p className="text-navy-soft">and {data.more} more waiting</p>}
            </div>
            {today.length === 0 ? (
              <p className="mt-4 rounded-lg bg-kelp-soft p-5 font-bold text-kelp">Every customer has an answer.</p>
            ) : (
              <ol className="mt-4 space-y-4">
                {today.map(item => (
                  <li key={item.id}>
                    <Message item={item} lead fresh={fresh.has(item.id)} onAct={act} onSend={send} busy={pending} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.themes.length > 0 && (
            <section className="mt-12" aria-labelledby="saying">
              <h2 id="saying" className="text-2xl font-bold">What customers keep saying</h2>
              <ul className="mt-3 space-y-1.5">
                {data.themes.map(t => (
                  <li key={t.title} className="flex gap-3"><span className="w-8 text-right font-bold">{t.count}</span><span>{t.title}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-12" aria-labelledby="all">
            <h2 id="all" className="text-2xl font-bold">Everything else</h2>
            <div role="tablist" className="mt-4 flex gap-1 border-b border-shore">
              {(['waiting', 'answered', 'spam'] as Status[]).map(s => {
                const n = s === 'waiting' ? Math.max(0, data.counts.waiting - today.length) : data.counts[s];
                return (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={tab === s}
                    onClick={() => setTab(s)}
                    className={`-mb-px border-b-[3px] px-3 py-2 text-[15px] capitalize ${tab === s ? 'border-navy font-bold' : 'border-transparent text-navy-soft'}`}
                  >
                    {s} {n}
                  </button>
                );
              })}
            </div>
            {listed.length === 0 ? (
              <p className="py-6 text-navy-soft">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-shore">
                {listed.map(item => (
                  <li key={item.id}>
                    <Message item={item} fresh={fresh.has(item.id)} onAct={act} onSend={send} busy={pending} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button onClick={() => start(() => clearAll())} className="mt-16 text-sm text-navy-soft underline underline-offset-4">
            Start over with no messages
          </button>
        </>
      )}

      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-5 z-10 mx-auto flex w-[min(92vw,30rem)] items-center gap-4 rounded-xl bg-navy px-5 py-3.5 text-white shadow-lg">
          <span className="flex-1">{toast.text}</span>
          {toast.undo && (
            <button onClick={() => undo(toast.undo!)} className="font-bold text-lamp">Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
        <path d="M9 10h8l2 18H7z" fill="#13294B" />
        <rect x="8" y="4" width="10" height="6" rx="1.5" fill="#F2B705" />
        <path d="M18 7 26 3v8z" fill="#F2B705" opacity="0.45" />
        <path d="M8 7 0 3v8z" fill="#F2B705" opacity="0.45" />
        <rect x="5" y="27" width="16" height="3" rx="1" fill="#13294B" />
      </svg>
      <span className="text-xl font-bold tracking-tight">Lighthouse</span>
    </div>
  );
}

function Tally({ counts, items }: { counts: Counts; items: InboxItem[] }) {
  const order: Status[] = ['answered', 'waiting', 'spam'];
  const notches = order.flatMap(s => items.filter(i => i.status === s).map(i => ({ id: i.id, s })));
  const ok = counts.missed === 0;
  return (
    <section className="mt-8" aria-label="Your messages, counted">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="text-[2.6rem] font-bold leading-none">
          {counts.arrived} <span className="text-2xl font-normal text-navy-soft">arrived</span>
        </p>
        <p className={`text-[2.6rem] font-bold leading-none ${ok ? 'text-kelp' : 'text-alarm'}`}>
          {counts.missed} <span className="text-2xl font-normal">missed</span>
        </p>
      </div>
      <div className="mt-4 flex gap-[3px]" aria-hidden="true">
        {notches.map(n => <span key={n.id} className={`notch ${STATUS_COLOR[n.s]}`} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
        {order.map(s => (
          <li key={s} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-sm ${STATUS_COLOR[s]}`} />
            <span><b>{counts[s]}</b> {s}</span>
          </li>
        ))}
      </ul>
      {!ok && (
        <p role="alert" className="mt-3 font-bold text-alarm">
          {counts.missed} message{counts.missed === 1 ? ' is' : 's are'} stored but not on this list. Do not trust this screen until it is fixed.
        </p>
      )}
    </section>
  );
}

function Message({ item, lead, fresh, onAct, onSend, busy }: {
  item: InboxItem;
  lead?: boolean;
  fresh: boolean;
  onAct: (i: InboxItem, s: Status) => void;
  onSend: (i: InboxItem, text: string) => void;
  busy: boolean;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(item.draft);
  const [drafting, setDrafting] = useState(false);

  // The fixed draft shows at once. The reply agent's draft replaces it only if the owner has not started typing.
  async function startReply() {
    setWriting(true);
    setDrafting(true);
    const better = await draftFor(item.id).catch(() => null);
    setDrafting(false);
    if (better) setText(current => (current === item.draft ? better : current));
  }
  const waiting = item.status === 'waiting';
  const shell = lead ? 'rounded-xl border-l-[5px] border-lamp bg-white p-5 shadow-[0_1px_0_#dfe7ec]' : 'py-5';

  return (
    <article className={`${shell} ${fresh ? 'arrived' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-bold">{item.author === 'Unknown' ? 'Someone' : item.author}</h3>
        <span className="text-[15px] text-navy-soft">{item.platform}, {when(item.receivedAt)}</span>
        {item.stars !== undefined && <span className="text-[15px]" aria-label={`${item.stars} out of 5 stars`}>{'★'.repeat(item.stars)}<span className="text-shore">{'★'.repeat(5 - item.stars)}</span></span>}
      </div>
      <p className="mt-1.5 max-w-[60ch] whitespace-pre-line">{item.text}</p>

      {waiting && item.reasons.length > 0 && (
        <p className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Why this is near the top">
          {item.reasons.map(r => <span key={r} className="rounded-md bg-lamp-soft px-2 py-0.5 text-[15px] font-bold">{r}</span>)}
        </p>
      )}

      {item.reply && <p className="mt-3 border-l-2 border-kelp pl-3 text-[15px] text-kelp">Your reply: {item.reply}</p>}

      {writing ? (
        <div className="mt-4">
          <label className="text-[15px] font-bold" htmlFor={`reply-${item.id}`}>{drafting ? 'Writing it the way you write…' : 'Your reply, written the way you write'}</label>
          <textarea
            id={`reply-${item.id}`}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-lg border border-shore bg-mist p-3"
          />
          <div className="mt-2 flex gap-2">
            <button disabled={busy || !text.trim()} onClick={() => { onSend(item, text); setWriting(false); }} className="rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-50">Send reply</button>
            <button onClick={() => setWriting(false)} className="px-3 py-2 text-navy-soft">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-1.5 sm:gap-2">
          {waiting && <button disabled={busy} onClick={startReply} className="rounded-lg bg-navy px-3.5 py-2 font-bold text-white sm:px-4">Reply</button>}
          {waiting && <button disabled={busy} onClick={() => onAct(item, 'answered')} className="rounded-lg border border-shore bg-white px-3.5 py-2 sm:px-4">Mark answered</button>}
          {waiting && <button disabled={busy} onClick={() => onAct(item, 'spam')} className="rounded-lg px-2.5 py-2 text-navy-soft sm:px-3">Spam</button>}
          {!waiting && <button disabled={busy} onClick={() => onAct(item, 'waiting')} className="rounded-lg border border-shore bg-white px-4 py-2">{item.status === 'spam' ? 'Not spam' : 'Back to waiting'}</button>}
        </div>
      )}
    </article>
  );
}

function FileButton({ onFiles, quiet }: { onFiles: (f: FileList | null) => void; quiet?: boolean }) {
  return (
    <label className={`cursor-pointer rounded-lg px-4 py-2 font-bold focus-within:outline focus-within:outline-3 ${quiet ? 'border border-shore bg-white text-sm' : 'bg-navy text-white'}`}>
      Add files
      <input type="file" accept=".txt,.csv" multiple className="sr-only" onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

function Welcome({ onFiles, onSample, busy }: { onFiles: (f: FileList | null) => void; onSample: () => void; busy: boolean }) {
  return (
    <section className="mt-16 max-w-[34rem]">
      <h1 className="text-[2.4rem] font-bold leading-tight">Every customer message in one list.</h1>
      <p className="mt-3 text-lg text-navy-soft">
        Add a WhatsApp chat export or a reviews file. Lighthouse counts every message, puts the most urgent on top, and shows you nothing was missed.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <FileButton onFiles={onFiles} />
        <button disabled={busy} onClick={onSample} className="rounded-lg border border-shore bg-white px-4 py-2 font-bold disabled:opacity-50">
          {busy ? 'Opening the bakery' : 'Try the sample bakery'}
        </button>
      </div>
      <p className="mt-6 text-[15px] text-navy-soft">
        A reviews file needs the columns platform, name, date and text. Stars are optional.
      </p>
    </section>
  );
}

function WhichNameIsYou({ names }: { names: string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <section className="mt-6 rounded-xl border-2 border-navy bg-white p-5" aria-labelledby="who">
      <h2 id="who" className="text-lg font-bold">Which name is you?</h2>
      <p className="mt-1 text-navy-soft">Your own messages teach the reply tone and are never counted as customers.</p>
      <div className="mt-4 flex flex-wrap gap-1.5 sm:gap-2">
        {names.map(n => {
          const on = picked.includes(n);
          return (
            <button
              key={n}
              aria-pressed={on}
              onClick={() => setPicked(p => (on ? p.filter(x => x !== n) : [...p, n]))}
              className={`rounded-full border px-4 py-1.5 ${on ? 'border-navy bg-navy text-white' : 'border-shore'}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <button disabled={!picked.length || pending} onClick={() => start(() => chooseOwner(picked))} className="mt-4 rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-40">
        That&apos;s me
      </button>
    </section>
  );
}
