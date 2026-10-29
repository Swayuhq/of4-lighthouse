'use client';
// "Checked 20 seconds ago", kept true while the owner looks at it.
import { useEffect, useState } from 'react';

export function Ago({ at }: { at: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (!at) return <>not checked yet</>;
  // The server and the browser clocks differ, so the words wait for the browser.
  if (now === null) return <>checked just now</>;
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 10) return <>checked just now</>;
  if (s < 60) return <>checked {s} seconds ago</>;
  const m = Math.round(s / 60);
  if (m < 60) return <>checked {m} minute{m === 1 ? '' : 's'} ago</>;
  const h = Math.round(m / 60);
  return <>checked {h} hour{h === 1 ? '' : 's'} ago</>;
}
