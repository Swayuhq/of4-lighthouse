// What the connector gateway did, in plain sentences, newest first. Built from the ledger rows written at each call.
export type CallRow = { id: number; lead: string; channel: string; action: string; outcome: string; provider: string | null; note: string | null; at: Date };
export type Activity = { id: number; text: string; times: number; at: Date; kind: 'ok' | 'waiting' | 'stopped'; routine: boolean };

const CHANNEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', google_reviews: 'Google reviews', google_places: 'Google Maps' };
const PROVIDER: Record<string, string> = { composio: 'Composio', zernio: 'Zernio', own: 'Swayu' };

export function sentence(r: CallRow): string {
  const channel = CHANNEL[r.channel] ?? r.channel;
  const via = r.provider ? ` through ${PROVIDER[r.provider] ?? r.provider}` : '';
  if (r.outcome === 'refused') return `Stopped: ${r.note ?? 'not allowed.'}`;
  if (r.outcome === 'failed') return `Failed: ${r.note ?? 'unknown error.'}`;
  if (r.action === 'read' && r.channel === 'google_places') return `Looked up nearby businesses on ${channel}${via}.`;
  if (r.action === 'read') return `Read new ${r.channel === 'google_reviews' ? 'reviews' : 'comments'} on ${channel}${via}.`;
  if (r.outcome === 'held') return `Wrote a reply on ${channel} and kept it for you to send.`;
  if (r.outcome === 'approved') return `You pressed Send on a ${channel} reply.`;
  if (r.outcome === 'declined') return `A reply on ${channel} was not sent.`;
  return `Posted your reply on ${channel}${via}.`;
}

/** How far back a routine read may fold into an earlier line, so channels checked in turn still fold. */
const FOLD_BACK = 4;

/** Newest first. A sentence repeated back to back shows once with a count; a routine read also folds across the other channels' reads. */
export function activity(rows: CallRow[]): Activity[] {
  const out: Activity[] = [];
  for (const r of [...rows].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)) {
    const text = sentence(r);
    const last = out.at(-1);
    const routine = r.action === 'read' && r.outcome === 'done';
    const same = routine
      ? out.slice(-FOLD_BACK).find(a => a.text === text && out.slice(out.indexOf(a) + 1).every(b => b.routine))
      : last && last.text === text ? last : undefined;
    if (same) {
      same.times += 1;
      continue;
    }
    const kind = r.outcome === 'refused' || r.outcome === 'failed' ? 'stopped' : r.outcome === 'held' ? 'waiting' : 'ok';
    out.push({ id: r.id, text, times: 1, at: r.at, kind, routine });
  }
  return out;
}
