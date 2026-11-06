// Reads the same channel through Composio and Zernio on the real test accounts and prints one comparison row each.
// Read only: it never replies. Run with scripts/compare.sh, which loads the keys from 1Password.
import { composio, zernioProvider, type Item } from '../src/gateway/providers';
import type { Provider } from '../src/gateway/gateway';
import { TENANT } from '../src/tenant';

const CHANNELS = (process.argv[2] ?? 'facebook,instagram,google_reviews').split(',');
const PROVIDERS: Record<string, Provider> = { composio, zernio: zernioProvider };

type Row = { channel: string; provider: string; ok: boolean; ms: number; items: number; withAuthor: number; withTime: number; withStars: number; note: string };
const rows: Row[] = [];

for (const channel of CHANNELS) {
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const start = performance.now();
    try {
      const items = (await provider(channel, 'read', {}, TENANT)) as Item[];
      rows.push({
        channel, provider: name, ok: true, ms: Math.round(performance.now() - start), items: items.length,
        withAuthor: items.filter(i => i.author && i.author !== 'Someone').length,
        withTime: items.filter(i => i.at).length,
        withStars: items.filter(i => typeof i.stars === 'number').length,
        note: '',
      });
    } catch (e) {
      rows.push({ channel, provider: name, ok: false, ms: Math.round(performance.now() - start), items: 0, withAuthor: 0, withTime: 0, withStars: 0, note: (e as Error).message.slice(0, 120) });
    }
  }
}

console.table(rows);
console.log(JSON.stringify({ at: new Date().toISOString(), rows }));
