// Points Zernio's webhook for Lighthouse at an address, or asks Zernio to send it a sample event.
// Endpoints from the zernio crate's WebhooksApi on docs.rs, read 5 Nov 2026: GET, POST and PUT /v1/webhooks/settings,
// POST /v1/webhooks/test. The key and the secret come from the environment, filled from 1Password by zernio-webhook.sh.
// Zernio's answers carry the secret, so only the id, address, events and state are ever printed.
//   zernio-webhook.sh set https://<tunnel>/api/webhooks/zernio
//   zernio-webhook.sh test
const BASE = 'https://zernio.com/api/v1';
const NAME = 'Lighthouse inbox';
const EVENTS = ['comment.received', 'review.new'];

type Hook = { _id?: string; name?: string; url?: string; events?: string[]; isActive?: boolean; failureCount?: number; lastFiredAt?: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.SWAYU_ZERNIO_API_KEY;
  if (!key) throw new Error('SWAYU_ZERNIO_API_KEY is not set');
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`Zernio ${method} ${path}: HTTP ${res.status} ${out.error ?? out.message ?? ''}`.trim());
  return out;
}

const show = (h: Hook | undefined) => h && { id: h._id, name: h.name, url: h.url, events: h.events, active: h.isActive, failures: h.failureCount, lastFired: h.lastFiredAt };

async function ours(): Promise<Hook | undefined> {
  const { webhooks = [] } = await call<{ webhooks?: Hook[] }>('GET', '/webhooks/settings');
  return webhooks.find(h => h.name === NAME);
}

const [action, url] = process.argv.slice(2);
if (action === 'set') {
  if (!url?.startsWith('https://') || !url.endsWith('/api/webhooks/zernio')) throw new Error('give the https tunnel address ending in /api/webhooks/zernio');
  const secret = process.env.SWAYU_ZERNIO_WEBHOOK_SECRET;
  if (!secret) throw new Error('SWAYU_ZERNIO_WEBHOOK_SECRET is not set');
  const found = await ours();
  if (found?._id) await call('PUT', '/webhooks/settings', { webhookId: found._id, url, secret, events: EVENTS, isActive: true });
  else await call('POST', '/webhooks/settings', { name: NAME, url, secret, events: EVENTS, isActive: true });
  console.log(found ? 'updated' : 'created', show(await ours()));
} else if (action === 'test') {
  const found = await ours();
  if (!found?._id) throw new Error(`no webhook named ${NAME} in Zernio`);
  await call('POST', '/webhooks/test', { webhookId: found._id, event: 'comment.received' });
  console.log('sample comment.received sent to', found.url);
} else {
  throw new Error('use: set <url> | test');
}
