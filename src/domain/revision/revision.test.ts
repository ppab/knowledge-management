import { describe, expect, it } from 'vitest';
import {
  abbreviate,
  findRevision,
  isUnsaved,
  previousRevision,
  type Revision,
} from './revision.js';

const rev = (id: string): Revision => ({
  id,
  timestamp: '2026-10-27T12:00:00Z',
  summary: id,
  path: 'n.md',
});
const history = [rev('abcdef1234567890'), rev('abcd999999999999'), rev('0123456789abcdef')];

describe('revisions', () => {
  it('finds by full id, by unique prefix, and refuses short or ambiguous prefixes', () => {
    expect(findRevision(history, '0123456789abcdef')).toMatchObject({ ok: true });
    expect(findRevision(history, 'abcde')).toMatchObject({
      ok: true,
      value: { id: 'abcdef1234567890' },
    });
    expect(findRevision(history, 'abcd')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
    expect(findRevision(history, 'abc')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(findRevision(history, 'zzzz')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('walks to the previous revision and abbreviates ids', () => {
    expect(previousRevision(history, history[0]!)?.id).toBe('abcd999999999999');
    expect(previousRevision(history, history[2]!)).toBeUndefined();
    expect(previousRevision(history, rev('nope'))).toBeUndefined();
    expect(abbreviate('abcdef1234567890')).toBe('abcdef1');
  });

  it('knows which statuses have something to save', () => {
    expect(isUnsaved({ kind: 'unversioned' })).toBe(false);
    expect(isUnsaved({ kind: 'unrecorded' })).toBe(true);
    expect(isUnsaved({ kind: 'clean', last: history[0]! })).toBe(false);
    expect(isUnsaved({ kind: 'modified', last: history[0]! })).toBe(true);
  });
});
