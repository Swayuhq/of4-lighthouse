'use client';
// "Updated 20 seconds ago", kept true while the owner looks at it. A check and a push both count as an update.
import { useEffect, useState } from 'react';

/** `lead` is the word before the time; the activity page passes an empty one. */
export function Ago({ at, lead = 'updated ' }: { at: string | null; lead?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (!at) return <>not updated yet</>;
  // The server and the browser clocks differ, so the words wait for the browser.
  if (now === null) return <>{lead}just now</>;
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 10) return <>{lead}just now</>;
  if (s < 60) return <>{lead}{s} seconds ago</>;
  const m = Math.round(s / 60);
  if (m < 60) return <>{lead}{m} minute{m === 1 ? '' : 's'} ago</>;
  const h = Math.round(m / 60);
  return <>{lead}{h} hour{h === 1 ? '' : 's'} ago</>;
}
