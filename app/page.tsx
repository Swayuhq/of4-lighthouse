// The front door: what Lighthouse does, shown with one real morning at a bakery, then one way in.
import Link from 'next/link';
import { businessName } from '@/src/store/db';
import type { Channel } from '@/src/connectors';
import { ChannelBadge, Wordmark } from './brand';

export const dynamic = 'force-dynamic';

// The same comments the sample channels carry, so the picture matches what the inbox will show.
const ARRIVING: { channel: Channel; who: string; text: string }[] = [
  { channel: 'instagram', who: 'sofia.bakes', text: 'Do you deliver to Park Street?' },
  { channel: 'google_reviews', who: 'Priya', text: 'The cake arrived damaged. I want my money back.' },
  { channel: 'whatsapp', who: 'Tom', text: 'My order has not been delivered yet. It was due at 10.' },
  { channel: 'facebook', who: 'Kwame Mensah', text: 'Are you open on Sunday?' },
];

// The real top three Lighthouse puts on top for these sample channels, with its own reasons.
const RANKED = [
  { who: 'Luca', where: 'Google review', why: ['2 stars', 'says wrong item'] },
  { who: 'Priya', where: 'Google review', why: ['1 star', 'says money back'] },
  { who: 'sofia.bakes', where: 'Instagram', why: [] as string[] },
];

const STEPS = [
  { title: 'Connect your channels', body: 'Instagram, Facebook, WhatsApp and Google reviews, one button each. Lighthouse reads them and never changes your profiles.' },
  { title: 'Lighthouse catches every message', body: 'It checks each channel on its own, reads every comment, review and chat, and spots refunds, late orders, repeat customers and spam.' },
  { title: 'You answer the urgent ones first', body: 'The three that matter most sit on top with the reason in plain words, and a reply already written the way you write.' },
];

export default async function Landing() {
  const signedUp = (await businessName()) !== null;
  const next = signedUp ? { href: '/inbox', label: 'Open my inbox' } : { href: '/start', label: 'Start free' };

  return (
    <>
      <div className="night text-white">
        <header className="mx-auto flex max-w-[72rem] items-center gap-4 px-4 pt-6 sm:px-6">
          <Wordmark tone="night" />
          <Link href={next.href} className="ml-auto rounded-lg bg-lamp px-4 py-2 font-bold text-navy">{next.label}</Link>
        </header>

        <section className="mx-auto grid max-w-[72rem] gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:items-center lg:pt-20">
          <div>
            <h1 className="max-w-[15ch] text-[2.6rem] font-bold leading-[1.08] sm:text-[3.4rem]">Every customer message in one list. None missed.</h1>
            <p className="mt-5 max-w-[44ch] text-lg text-white/75">
              Customers write on WhatsApp, Instagram, Facebook and Google. Lighthouse watches all four and puts the one that cannot wait on top.
            </p>
            <Link href={next.href} className="mt-8 inline-block rounded-lg bg-lamp px-6 py-3 text-lg font-bold text-navy">{next.label}</Link>
          </div>
          <Beam />
        </section>
      </div>

      <main className="mx-auto max-w-[72rem] px-4 py-20 sm:px-6">
        <h2 className="text-3xl font-bold">How it works</h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-navy text-lg font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
              <p className="mt-2 max-w-[36ch] text-navy-soft">{s.body}</p>
            </li>
          ))}
        </ol>

        <section className="mt-24 grid gap-10 border-t border-shore pt-16 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-3xl font-bold">A count you can check</h2>
            <p className="mt-3 max-w-[40ch] text-navy-soft">
              Every message that arrived is answered, waiting or spam. Anything else is missed, and Lighthouse says so in red.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6">
            <p className="text-[2.2rem] font-bold leading-none">10 <span className="text-xl font-normal text-navy-soft">arrived</span></p>
            <div className="mt-4 flex gap-[3px]" aria-hidden="true">
              {[...Array(3).fill('bg-kelp'), ...Array(6).fill('bg-lamp'), ...Array(1).fill('bg-slate')].map((c, i) => (
                <span key={i} className={`notch ${c}`} />
              ))}
            </div>
            <p className="mt-3 text-[15px]"><b>3</b> answered, <b>6</b> waiting, <b>1</b> spam, <b className="text-kelp">0 missed</b></p>
          </div>
        </section>
      </main>

      <footer className="border-t border-shore">
        <div className="mx-auto flex max-w-[72rem] flex-wrap items-center gap-4 px-4 py-8 text-[15px] text-navy-soft sm:px-6">
          <span>Lighthouse by Swayu</span>
          <Link href={next.href} className="ml-auto font-bold text-navy underline underline-offset-4">{next.label}</Link>
        </div>
      </footer>
    </>
  );
}

/** Four channels on the left, one ranked list on the right, the lamp between them sweeping its beam. */
function Beam() {
  return (
    <div className="relative grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center" role="img" aria-label="Messages from four channels become one list with the most urgent on top">
      <ul className="space-y-2.5">
        {ARRIVING.map(m => (
          <li key={m.who} className="flex items-start gap-2.5 rounded-xl bg-white/[0.07] p-2.5">
            <ChannelBadge channel={m.channel} />
            <span className="text-[14px] leading-snug">
              <b className="block">{m.who}</b>
              <span className="text-white/70">{m.text}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="relative mx-auto grid place-items-center sm:mx-0" aria-hidden="true">
        <span className="sweep" />
        <svg width="36" height="58" viewBox="0 0 26 30" className="relative">
          <path d="M9 10h8l2 18H7z" fill="#fff" />
          <rect x="8" y="4" width="10" height="6" rx="1.5" fill="#F2B705" />
          <rect x="5" y="27" width="16" height="3" rx="1" fill="#fff" />
        </svg>
      </div>

      <ol className="space-y-2.5">
        {RANKED.map((r, i) => (
          <li key={r.who} className={`rounded-xl bg-white p-3 text-navy ${i === 0 ? 'border-l-[5px] border-lamp' : ''}`}>
            <p className="text-[14px]"><b>{r.who}</b> <span className="text-navy-soft">{r.where}</span></p>
            {r.why.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1">
              {r.why.map(w => <span key={w} className="rounded-md bg-lamp-soft px-1.5 py-0.5 text-[13px] font-bold">{w}</span>)}
            </p>}
          </li>
        ))}
        <li className="px-1 pt-1 text-[15px] text-white/80">10 arrived, <b className="text-lamp">0 missed</b></li>
      </ol>
    </div>
  );
}
