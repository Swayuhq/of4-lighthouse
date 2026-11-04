import { describe, expect, it } from 'vitest';
import { commentLink } from '../src/gateway/providers';
import { checkMessages } from '../src/message';

describe('Each comment links to where it lives on the platform', () => {
  it('Instagram: the post permalink plus the comment', () => {
    expect(commentLink('instagram', 'https://www.instagram.com/p/DfUFz9VR2Uw/', '18120885953089972')).toBe('https://www.instagram.com/p/DfUFz9VR2Uw/c/18120885953089972/');
  });

  it('Facebook: the post permalink with the comment number', () => {
    expect(commentLink('facebook', 'https://www.facebook.com/122097038187534948', '122097038187534948_1107319325440407')).toBe('https://www.facebook.com/122097038187534948?comment_id=1107319325440407');
    expect(commentLink('facebook', 'https://www.facebook.com/permalink.php?story_fbid=1&id=2', '1_99')).toBe('https://www.facebook.com/permalink.php?story_fbid=1&id=2&comment_id=99');
  });

  it('no permalink, or one on another host, gives no link at all', () => {
    expect(commentLink('instagram', undefined, 'c1')).toBeUndefined();
    expect(commentLink('instagram', 'javascript:alert(1)//www.instagram.com/', 'c1')).toBeUndefined();
    expect(commentLink('instagram', 'https://evil.example/www.instagram.com/', 'c1')).toBeUndefined();
    expect(commentLink('facebook', 'https://www.instagram.com/p/x/', 'c1')).toBeUndefined();
  });
});

describe('A comment answered on the platform reaches the inbox as answered', () => {
  it('the flag travels from the provider item to the message', async () => {
    const { toMessages } = await import('../src/connectors');
    const { messages } = toMessages('instagram', [{ id: 'c1', ref: 'a|p|c1', author: 'lee', text: 'Hi', at: '2026-11-04T08:00:00Z', answered: true }]);
    expect(messages[0]).toMatchObject({ id: 'instagram:c1', answeredElsewhere: true });
  });
});

describe('The message shape refuses a link that is not the platform', () => {
  const base = { id: 'instagram:1', platform: 'Instagram', author: 'Mei', receivedAt: '2026-11-04T09:00', text: 'Hi' };
  it('keeps an Instagram or Facebook https link', () => {
    expect(checkMessages([{ ...base, link: 'https://www.instagram.com/p/x/c/1/' }]).messages).toHaveLength(1);
  });
  it('refuses any other link', () => {
    expect(checkMessages([{ ...base, link: 'javascript:alert(1)' }]).refused).toBe(1);
    expect(checkMessages([{ ...base, link: 'https://www.instagram.com.evil.example/p' }]).refused).toBe(1);
  });
});
