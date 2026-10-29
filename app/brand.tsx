// Pieces every Lighthouse screen shares: the mark, the channel badge and the sign up steps.
import Link from 'next/link';
import type { Channel } from '@/src/connectors';

export function Wordmark({ business, tone = 'day' }: { business?: string | null; tone?: 'day' | 'night' }) {
  const ink = tone === 'night' ? '#FFFFFF' : '#13294B';
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
        <path d="M9 10h8l2 18H7z" fill={ink} />
        <rect x="8" y="4" width="10" height="6" rx="1.5" fill="#F2B705" />
        <path d="M18 7 26 3v8z" fill="#F2B705" opacity="0.45" />
        <path d="M8 7 0 3v8z" fill="#F2B705" opacity="0.45" />
        <rect x="5" y="27" width="16" height="3" rx="1" fill={ink} />
      </svg>
      <span className="text-xl font-bold tracking-tight">Lighthouse</span>
      <span className={`text-sm ${tone === 'night' ? 'hidden text-white/60 sm:inline' : 'text-navy-soft'}`}>{business ?? 'by Swayu'}</span>
    </Link>
  );
}

const INITIALS: Record<Channel, string> = { instagram: 'IG', facebook: 'FB', whatsapp: 'WA', google_reviews: 'G' };

export function ChannelBadge({ channel, size = 'md' }: { channel: Channel; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm';
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl bg-navy font-bold text-white ring-1 ring-white/25 ${box}`}>
      {INITIALS[channel]}
    </span>
  );
}

const STEPS = ['Your business', 'Your channels', 'Your inbox'];

/** Where the owner is in sign up. The order is real: each step needs the one before it. */
export function Steps({ at }: { at: 0 | 1 | 2 }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]" aria-label="Sign up">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className={`flex items-center gap-2 ${i === at ? 'font-bold' : 'text-navy-soft'}`}>
          <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${i < at ? 'bg-kelp text-white' : i === at ? 'bg-navy text-white' : 'border border-shore'}`}>
            {i < at ? '✓' : i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}
