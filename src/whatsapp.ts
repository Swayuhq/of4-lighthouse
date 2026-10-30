// WhatsApp through Meta's Cloud API: customer messages arrive on our webhook, replies go out through the Graph API.
// Built on Meta's test number for the prototype on 30 Oct 2026. An owner's own number needs Swayu to become a Meta Tech Provider first.
// Keys are read from the environment on each call and never logged.
import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH = 'https://graph.facebook.com/v26.0';
const TIMEOUT_MS = 20_000;

/** True only when Meta signed this exact body with our app secret. */
export function signatureOk(body: string, header: string | null, secret: string | undefined): boolean {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Value = { contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: Record<string, unknown>[] };

/** Every customer message in one webhook, with the sender's profile name attached. Receipts and anything malformed add nothing. */
export function whatsappItems(payload: unknown): unknown[] {
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(e => (Array.isArray(e?.changes) ? e.changes : [])).flatMap((c: { value?: Value }) => {
    const { contacts = [], messages = [] } = c?.value ?? {};
    return messages.map(m => {
      const profile = contacts.find(k => k.wa_id === m.from)?.profile;
      return profile?.name ? { ...m, profile: { name: profile.name } } : m;
    });
  });
}

/** Sends the owner's reply to the customer, quoting their message, and returns WhatsApp's id for it. Throws unless WhatsApp takes it. */
export async function whatsappReply(platformId: string, body: string): Promise<string> {
  const token = process.env.SWAYU_WHATSAPP_TOKEN;
  const phone = process.env.SWAYU_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phone) throw new Error('SWAYU_WHATSAPP_TOKEN or SWAYU_WHATSAPP_PHONE_NUMBER_ID is not set. Start Lighthouse with pnpm start:op.');
  const [to, messageId] = platformId.split('|');
  const res = await fetch(`${GRAPH}/${phone}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      context: { message_id: messageId },
      text: { preview_url: false, body },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const out = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
  const id = out.messages?.[0]?.id;
  if (!res.ok || !id) throw new Error(`WhatsApp: ${out.error?.message ?? `HTTP ${res.status}`}`);
  return id;
}
