import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDraft } from '../src/agents/checker';

const ask = vi.fn();
vi.mock('../src/agents/model', () => ({ ask: (...a: unknown[]) => ask(...a) }));
const { writeReply } = await import('../src/agents/reply');

const customer = { id: 'a', platform: 'WhatsApp', author: 'Tom Lee', receivedAt: '2026-10-28T08:00', text: 'Can I get 12 croissants for Friday?' };
const ownerLines = ['Hi Priya! Yes, ready by 9 am 🙂 Asha', 'Hi Mei, so sorry. We will send a fresh one. Asha'];

beforeEach(() => ask.mockReset());

describe('checker', () => {
  it('passes a draft that only repeats what the customer or owner said', () => {
    expect(checkDraft('Hi Tom! Yes, 12 croissants for Friday, ready by 9 am 🙂 Asha', customer.text, ownerLines).ok).toBe(true);
  });

  it('refuses a price nobody gave', () => {
    const r = checkDraft('Hi Tom, that is ₹450 for 12.', customer.text, ownerLines);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('450');
  });

  it('refuses a day or time nobody gave', () => {
    expect(checkDraft('Hi Tom, ready on Saturday.', customer.text, ownerLines).ok).toBe(false);
    expect(checkDraft('Hi Tom, ready at 7:30.', customer.text, ownerLines).ok).toBe(false);
    expect(checkDraft('Hi Tom, ready tomorrow.', customer.text, ownerLines).ok).toBe(false);
  });

  it('refuses a promise the owner never makes, even when the customer asked for it', () => {
    const r = checkDraft('Hi Tom, we will refund you in full.', 'I need a refund.', ownerLines);
    expect(r.ok).toBe(false);
    expect(checkDraft('Hi Tom, we can refund you.', 'I need a refund.', [...ownerLines, 'Sorry, I will refund you today']).ok).toBe(true);
  });

  it('refuses an empty or very long draft', () => {
    expect(checkDraft('  ', customer.text, ownerLines).ok).toBe(false);
    expect(checkDraft('a '.repeat(400), customer.text, ownerLines).ok).toBe(false);
  });
});

describe('reply agent', () => {
  it('returns the model draft when the checker passes it', async () => {
    ask.mockResolvedValue({ reply: 'Hi Tom! Yes, 12 croissants for Friday 🙂 Asha' });
    expect(await writeReply(customer, ownerLines, undefined)).toBe('Hi Tom! Yes, 12 croissants for Friday 🙂 Asha');
  });

  it('returns null when the checker refuses, so the fixed draft stays', async () => {
    ask.mockResolvedValue({ reply: 'Hi Tom, that will be ₹450.' });
    expect(await writeReply(customer, ownerLines, undefined)).toBeNull();
  });

  it('returns null when the model fails', async () => {
    ask.mockResolvedValue(null);
    expect(await writeReply(customer, ownerLines, undefined)).toBeNull();
  });

  it('gives the model the owner lines as examples and the customer text inside a marked region', async () => {
    ask.mockResolvedValue(null);
    await writeReply(customer, ownerLines, { kind: 'order', problem: 'none', asks: '12 croissants', deadline: 'Friday' });
    const { input } = ask.mock.calls[0][0] as { input: string };
    expect(input).toContain(ownerLines[0]);
    expect(input.indexOf(customer.text)).toBeGreaterThan(input.indexOf('<message>'));
  });
});
