// Everything Swayu did on the owner's channels, newest first, one plain sentence each.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { activity } from '@/src/activity';
import { businessName, recentCalls } from '@/src/store/db';
import { Ago } from '../ago';
import { Wordmark } from '../brand';

export const dynamic = 'force-dynamic';

const DOT = { ok: 'bg-kelp', waiting: 'bg-lamp', stopped: 'bg-alarm' } as const;

export default async function Activity() {
  const name = await businessName();
  if (!name) redirect('/start');
  const items = activity(await recentCalls());

  return (
    <div className="mx-auto max-w-[44rem] px-4 pb-24 pt-6 sm:px-6">
      <header className="flex items-center">
        <Wordmark business={name} />
        <Link href="/inbox" className="ml-auto rounded-lg border border-shore bg-white px-4 py-2 text-sm font-bold">Inbox</Link>
      </header>
      <h1 className="mt-10 text-[2.2rem] font-bold leading-tight">Activity</h1>
      {items.length === 0 ? (
        <p className="mt-4 text-navy-soft">Nothing yet.</p>
      ) : (
        <ol className="mt-6 divide-y divide-shore">
          {items.map(a => (
            <li key={a.id} className="flex items-baseline gap-3 py-3">
              <span className={`h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full ${DOT[a.kind]}`} aria-hidden="true" />
              <span className={`flex-1 ${a.kind === 'stopped' ? 'font-bold' : ''}`}>
                {a.text}{a.times > 1 && <span className="text-navy-soft"> {a.times} times</span>}
              </span>
              <span className="shrink-0 text-[15px] text-navy-soft"><Ago at={a.at.toISOString()} lead="" /></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
