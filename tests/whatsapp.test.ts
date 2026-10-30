// The live WhatsApp path: Meta's webhook in, Cloud API reply out. Payloads follow Meta's text message webhook reference (read 30 Oct 2026).
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signatureOk, whatsappItems, whatsappReply } from '../src/whatsapp';
import { toMessages } from '../src/connectors';
import { proxy } from '../proxy';

const SECRET = 'app-secret';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const payload = (messages: unknown[], contacts = [{ profile: { name: 'Hatim' }, wa_id: '919800000001' }]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '555' }, contacts, messages } }] }],
});
const text = (id: string, body: string) => ({ from: '919800000001', id, timestamp: '1793360000', type: 'text', text: { body } });

describe('Checking that a webhook came from Meta', () => {
  it('accepts the body Meta signed with our app secret', () => {
    const body = JSON.stringify(payload([text('wamid.1', 'Open Sunday?')]));
    expect(signatureOk(body, sign(body), SECRET)).toBe(true);
  });

  it('refuses a body changed after signing, a wrong secret, a missing header and a missing secret', () => {
    const body = JSON.stringify(payload([text('wamid.1', 'Open Sunday?')]));
    expect(signatureOk(body.replace('Sunday', 'Monday'), sign(body), SECRET)).toBe(false);
    expect(signatureOk(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(signatureOk(body, null, SECRET)).toBe(false);
    expect(signatureOk(body, sign(body), undefined)).toBe(false);
    expect(signatureOk(body, 'sha256=short', SECRET)).toBe(false);
  });
});

describe('Reading customer messages from a webhook', () => {
  it('turns each text into one inbox message named after the sender', () => {
    const { messages, refused } = toMessages('whatsapp', whatsappItems(payload([text('wamid.1', 'Open Sunday?'), text('wamid.2', 'Do you deliver?')])));
    expect(refused).toBe(0);
    expect(messages.map(m => [m.id, m.author, m.text])).toEqual([
      ['whatsapp:919800000001|wamid.1', 'Hatim', 'Open Sunday?'],
      ['whatsapp:919800000001|wamid.2', 'Hatim', 'Do you deliver?'],
    ]);
  });

  it('refuses a photo or voice note it cannot read yet, and ignores delivery receipts and junk', () => {
    const photo = { from: '919800000001', id: 'wamid.3', timestamp: '1793360000', type: 'image', image: { id: 'm1' } };
    expect(toMessages('whatsapp', whatsappItems(payload([photo]))).refused).toBe(1);
    const receipt = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.9', status: 'read' }] } }] }] };
    expect(whatsappItems(receipt)).toEqual([]);
    expect(whatsappItems(null)).toEqual([]);
    expect(whatsappItems({ entry: 'nope' })).toEqual([]);
  });

  it('falls back to the phone number when the sender has no profile name', () => {
    const { messages } = toMessages('whatsapp', whatsappItems(payload([text('wamid.4', 'Hi')], [])));
    expect(messages[0].author).toBe('919800000001');
  });
});

describe('Replying on WhatsApp', () => {
  let sent: { url: string; init: RequestInit }[];
  beforeEach(() => {
    sent = [];
    process.env.SWAYU_WHATSAPP_TOKEN = 'token';
    process.env.SWAYU_WHATSAPP_PHONE_NUMBER_ID = '555';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the reply to the customer, quoting their message, and returns WhatsApp id for it', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Response.json({ messages: [{ id: 'wamid.reply' }] });
    });
    expect(await whatsappReply('919800000001|wamid.1', 'Yes, 9 to 5')).toBe('wamid.reply');
    expect(sent[0].url).toBe('https://graph.facebook.com/v26.0/555/messages');
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919800000001',
      type: 'text',
      context: { message_id: 'wamid.1' },
      text: { preview_url: false, body: 'Yes, 9 to 5' },
    });
  });

  it('throws when WhatsApp refuses, for example after the 24 hour window closes', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { message: 'Re-engagement message' } }, { status: 400 }));
    await expect(whatsappReply('919800000001|wamid.1', 'Hi')).rejects.toThrow('Re-engagement message');
  });

  it('throws before calling WhatsApp when the token is missing', async () => {
    delete process.env.SWAYU_WHATSAPP_TOKEN;
    await expect(whatsappReply('919800000001|wamid.1', 'Hi')).rejects.toThrow('SWAYU_WHATSAPP_TOKEN');
  });
});

describe('The tunnel guard', () => {
  const at = (url: string, host: string) => proxy(new NextRequest(url, { headers: { host } }));

  it('lets the laptop reach every page', () => {
    expect(at('http://127.0.0.1:4174/inbox', '127.0.0.1:4174').status).toBe(200);
    expect(at('http://localhost:4174/inbox', 'localhost:4174').status).toBe(200);
  });

  it('lets the tunnel reach only the webhooks', () => {
    expect(at('https://x.trycloudflare.com/api/webhooks/whatsapp', 'x.trycloudflare.com').status).toBe(200);
    expect(at('https://x.trycloudflare.com/inbox', 'x.trycloudflare.com').status).toBe(404);
    expect(at('https://x.trycloudflare.com/api/connections/facebook/pull', 'x.trycloudflare.com').status).toBe(404);
    expect(at('https://x.trycloudflare.com/', 'x.trycloudflare.com').status).toBe(404);
  });
});
