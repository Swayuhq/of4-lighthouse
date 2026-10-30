// The live Facebook path through Composio, with Composio's answers faked in the shape it really returns (probed 30 Oct 2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facebookComments, facebookReply } from '../src/composio';

type Call = { slug: string; args: Record<string, unknown> };

/** Wraps a result the way Composio's MCP endpoint does: a server sent event holding JSON text holding the result. */
function answer(data: unknown, error: string | null = null) {
  const inner = { successful: !error, data: { results: [{ response: { successful: !error, data }, error }] }, error };
  return new Response(`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(inner) }] } })}\n`);
}

let calls: Call[];
function fake(reply: (c: Call) => Response) {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const tool = JSON.parse(String(init.body)).params.arguments.tools[0];
    const c = { slug: tool.tool_slug, args: tool.arguments };
    calls.push(c);
    return reply(c);
  });
}

beforeEach(() => {
  calls = [];
  process.env.SWAYU_COMPOSIO_API_KEY = 'test-key';
});
afterEach(() => vi.unstubAllGlobals());

const comment = (id: string, message: string) => ({ id, message, created_time: '2026-10-30T08:21:37+0000', from: { id: '9', name: 'Asha' } });

describe('Reading Facebook comments through Composio', () => {
  it('brings every comment on the Page posts, as Meta writes them', async () => {
    fake(c => {
      if (c.slug === 'FACEBOOK_LIST_MANAGED_PAGES') return answer({ data: [{ id: '140', name: 'Test Cafe' }] });
      if (c.slug === 'FACEBOOK_GET_PAGE_POSTS') return answer({ data: [{ id: '140_1' }, { id: '140_2' }] });
      return answer({ data: c.args.object_id === '140_1' ? [comment('1_11', 'Lovely cake')] : [comment('2_21', 'Open Sunday?')] });
    });
    const items = await facebookComments();
    expect(items).toEqual([comment('1_11', 'Lovely cake'), comment('2_21', 'Open Sunday?')]);
    expect(calls.find(c => c.slug === 'FACEBOOK_GET_PAGE_POSTS')?.args.page_id).toBe('140');
  });

  it('a Page with no posts brings nothing and is not an error', async () => {
    fake(c => answer({ data: c.slug === 'FACEBOOK_LIST_MANAGED_PAGES' ? [{ id: '140', name: 'Test Cafe' }] : [] }));
    expect(await facebookComments()).toEqual([]);
  });

  it('no Page on the Facebook login fails with a sentence the owner can act on', async () => {
    fake(() => answer({ data: [] }));
    await expect(facebookComments()).rejects.toThrow('No Facebook Page');
  });

  it('a refusal from Composio fails the read instead of looking like an empty Page', async () => {
    fake(() => answer(null, 'Facebook token expired'));
    await expect(facebookComments()).rejects.toThrow('Facebook token expired');
  });

  it('without the key nothing is called', async () => {
    delete process.env.SWAYU_COMPOSIO_API_KEY;
    fake(() => answer({ data: [] }));
    await expect(facebookComments()).rejects.toThrow('SWAYU_COMPOSIO_API_KEY');
    expect(calls).toHaveLength(0);
  });
});

describe('Replying on Facebook through Composio', () => {
  it('sends the comment number alone, because Composio reads the part before the underscore as a Page', async () => {
    fake(() => answer({ id: '11_99' }));
    expect(await facebookReply('1_11', 'Thank you!')).toBe('11_99');
    expect(calls).toEqual([{ slug: 'FACEBOOK_CREATE_COMMENT', args: { object_id: '11', message: 'Thank you!' } }]);
  });

  it('a reply Composio refuses throws, so the owner is never told it was sent', async () => {
    fake(() => answer(null, 'Permission denied'));
    await expect(facebookReply('1_11', 'Thank you!')).rejects.toThrow('Permission denied');
  });

  it('a reply with no id back counts as not sent', async () => {
    fake(() => answer({}));
    await expect(facebookReply('1_11', 'Thank you!')).rejects.toThrow();
  });
});
