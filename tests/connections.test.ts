// Runs against the local lighthouse_test database, never the demo one.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.LIGHTHOUSE_DB_NAME = 'lighthouse_test';
const { connect, connections, load, markBroken, startOver, storeFromChannel } = await import('../src/store/db');

const msg = (id: string) => ({ id, platform: 'Instagram', author: 'priya.k', receivedAt: '2026-10-29T09:15', text: 'Park Street?' });

beforeEach(() => startOver());
afterAll(() => startOver());

describe('Connecting a channel', () => {
  it('a new channel starts connected at the start of its feed', async () => {
    await connect('instagram');
    expect(await connections()).toMatchObject([{ channel: 'instagram', status: 'connected', cursor: 0, problem: null }]);
  });

  it('connecting again keeps the cursor, so old comments are not read twice', async () => {
    await connect('instagram');
    await storeFromChannel('instagram', [msg('instagram:1')], 1);
    await connect('instagram');
    expect((await connections())[0].cursor).toBe(1);
  });

  it('reconnecting a broken channel clears the problem', async () => {
    await connect('google_reviews');
    await markBroken('google_reviews', 'Google stopped letting Swayu read your reviews.');
    expect((await connections())[0]).toMatchObject({ status: 'broken', problem: 'Google stopped letting Swayu read your reviews.' });
    await connect('google_reviews');
    expect((await connections())[0]).toMatchObject({ status: 'connected', problem: null });
  });
});

describe('Bringing comments in from a channel', () => {
  it('stores the messages and moves the cursor together', async () => {
    await connect('instagram');
    expect(await storeFromChannel('instagram', [msg('instagram:1'), msg('instagram:2')], 2)).toBe(2);
    expect((await load()).messages).toHaveLength(2);
    expect((await connections())[0].cursor).toBe(2);
  });

  it('a comment already stored is counted once', async () => {
    await connect('instagram');
    await storeFromChannel('instagram', [msg('instagram:1')], 1);
    expect(await storeFromChannel('instagram', [msg('instagram:1')], 1)).toBe(0);
    expect((await load()).messages).toHaveLength(1);
  });

  it('a channel the owner never connected is refused and stores nothing', async () => {
    await expect(storeFromChannel('facebook', [msg('facebook:1')], 1)).rejects.toThrow('not connected');
    expect((await load()).messages).toEqual([]);
  });

  it('a broken channel is refused too, so nothing arrives from a channel Swayu cannot see', async () => {
    await connect('facebook');
    await markBroken('facebook', 'Facebook asked you to log in again.');
    await expect(storeFromChannel('facebook', [msg('facebook:1')], 1)).rejects.toThrow('not connected');
  });
});

it('Start over disconnects every channel', async () => {
  await connect('instagram');
  await startOver();
  expect(await connections()).toEqual([]);
});
