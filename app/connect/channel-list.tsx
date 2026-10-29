'use client';
// The four channel cards. Connecting is the switch: there is no separate button to start watching.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { addFile, connectChannel, type AddResult } from '../actions';
import { Ago } from '../ago';
import { ChannelBadge } from '../brand';
import type { ChannelView } from '../channels';

type Result = { added: number; refused: number; problem?: string };

export function ChannelList({ channels }: { channels: ChannelView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [, start] = useTransition();
  const anyConnected = channels.some(c => c.status === 'connected');

  function connect(channel: string) {
    setBusy(channel);
    start(async () => {
      const r = await connectChannel(channel);
      setResults(prev => ({ ...prev, [channel]: r }));
      setBusy(null);
    });
  }

  return (
    <>
      <ul className="mt-8 divide-y divide-shore rounded-2xl border border-shore bg-white">
        {channels.map(c => (
          <li key={c.channel} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
            <ChannelBadge channel={c.channel} size="lg" />
            <div className="min-w-[12rem] flex-1">
              <h2 className="text-lg font-bold">{c.label}</h2>
              <Status view={c} result={results[c.channel]} />
            </div>
            {c.status === 'connected' ? (
              <span className="flex items-center gap-2 font-bold text-kelp"><span className="h-2.5 w-2.5 rounded-full bg-kelp" />Live</span>
            ) : (
              <button
                disabled={busy !== null}
                onClick={() => connect(c.channel)}
                className="rounded-lg bg-navy px-5 py-2.5 font-bold text-white disabled:opacity-50"
              >
                {busy === c.channel ? 'Connecting…' : c.status === 'broken' ? 'Connect again' : 'Connect'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[15px] text-navy-soft">
        Until Meta and Google approve Swayu, each channel reads a sample feed from a test bakery. Connecting, checking and counting run for real.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
        {anyConnected ? (
          <Link href="/inbox" className="rounded-lg bg-navy px-6 py-3 text-lg font-bold text-white">Open my inbox</Link>
        ) : (
          <span className="rounded-lg bg-shore px-6 py-3 text-lg font-bold text-navy-soft" aria-disabled="true">Open my inbox</span>
        )}
        <FromFile />
      </div>
    </>
  );
}

function Status({ view, result }: { view: ChannelView; result?: Result }) {
  if (view.status === 'broken') return <p className="text-[15px] font-bold text-alarm">{view.problem}</p>;
  if (view.status === 'not_connected') return <p className="text-[15px] text-navy-soft">{view.reads}</p>;
  return (
    <p className="text-[15px] text-navy-soft">
      {view.caught} message{view.caught === 1 ? '' : 's'} caught, <Ago at={view.checkedAt} />
      {result && result.refused > 0 && (
        <span className="block text-alarm">{result.refused} could not be read and {result.refused === 1 ? 'is' : 'are'} left out of the count</span>
      )}
    </p>
  );
}

/** The fallback for a channel the owner cannot connect: a WhatsApp chat export or a reviews CSV, once. */
function FromFile() {
  const [note, setNote] = useState<string | null>(null);
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const results: AddResult[] = [];
    for (const f of Array.from(files)) results.push(await addFile(f.name, await f.text()));
    const added = results.reduce((n, r) => n + r.added, 0);
    const problems = results.filter(r => r.problem).map(r => `${r.file}: ${r.problem}`);
    setNote(problems.length ? problems.join(' ') : added ? `${added} message${added === 1 ? '' : 's'} brought in` : 'Nothing new. These messages are already here.');
  }
  return (
    <div>
      <label className="cursor-pointer font-bold underline underline-offset-4 focus-within:outline focus-within:outline-3">
        Bring in old chats from a file
        <input type="file" accept=".txt,.csv" multiple className="sr-only" onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
      </label>
      {note && <p role="status" className="mt-1 text-[15px] text-navy-soft">{note}</p>}
    </div>
  );
}
