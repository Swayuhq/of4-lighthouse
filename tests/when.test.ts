import { describe, expect, it } from 'vitest';
import { when } from '../src/when';

describe('when a message arrived, as the owner reads it', () => {
  it('shows a live comment, stored in UTC, on the owner clock', () => {
    // Facebook said 14:45 UTC on 6 Nov; the owner in India saw it at 8:15 pm.
    expect(when('2026-11-06T14:45', true)).toBe('6 Nov, 8:15 pm');
  });

  it('moves to the next day when the owner clock passes midnight', () => {
    expect(when('2026-11-06T19:00', true)).toBe('7 Nov, 12:30 am');
  });

  it('leaves a chat export alone, because it already carries the owner clock', () => {
    expect(when('2026-11-06T14:45', false)).toBe('6 Nov, 2:45 pm');
  });
});
