import { describe, expect, it } from 'vitest';
import type { Visibility } from '../note/note.js';
import type { Publication } from './publication.js';
import { selectCandidates, type PublicationCandidate } from './select.js';

const candidate = (
  overrides: Partial<PublicationCandidate> & Pick<PublicationCandidate, 'id' | 'path'>,
): PublicationCandidate => ({
  vault: 'main',
  title: overrides.id,
  visibility: 'public' as Visibility,
  tags: [],
  dates: [],
  fields: {},
  version: 'v',
  references: [],
  ...overrides,
});

const publication = (overrides: Partial<Publication>): Publication => ({
  name: 'site',
  destination: { kind: 'markdown', options: {} },
  output: './dist',
  route: '/{{slug}}/',
  include: [],
  exclude: [],
  references: 'fail',
  ...overrides,
});

describe('selectCandidates', () => {
  it('admits an eligible note and drops a private one, with the private reason', () => {
    const pub = publication({});
    const notes = [
      candidate({ id: 'PUB', path: 'docs/a.md' }),
      candidate({ id: 'PRIV', path: 'docs/b.md', visibility: 'private' }),
    ];
    const result = selectCandidates(pub, notes, 'main');
    expect(result.included.map((n) => n.id)).toEqual(['PUB']);
    expect(result.excluded).toEqual([
      { candidate: notes[1], reason: { kind: 'private' } },
    ]);
  });

  it('a glob never admits a private note (visibility is checked first)', () => {
    const pub = publication({ include: ['docs/**'] });
    const notes = [candidate({ id: 'PRIV', path: 'docs/secret.md', visibility: 'private' })];
    const result = selectCandidates(pub, notes, 'main');
    expect(result.included).toEqual([]);
    expect(result.excluded[0]?.reason).toEqual({ kind: 'private' });
  });

  it('applies include then exclude with their reasons', () => {
    const pub = publication({ include: ['docs/**'], exclude: ['docs/drafts/**'] });
    const notes = [
      candidate({ id: 'IN', path: 'docs/a.md' }),
      candidate({ id: 'OUT', path: 'posts/a.md' }),
      candidate({ id: 'DRAFT', path: 'docs/drafts/a.md' }),
    ];
    const result = selectCandidates(pub, notes, 'main');
    expect(result.included.map((n) => n.id)).toEqual(['IN']);
    expect(result.excluded).toEqual([
      { candidate: notes[1], reason: { kind: 'not-included' } },
      { candidate: notes[2], reason: { kind: 'excluded', by: 'docs/drafts/**' } },
    ]);
  });

  it('scopes to the defining vault by default and honours an explicit vaults list', () => {
    const notes = [
      candidate({ id: 'HERE', path: 'a.md', vault: 'main' }),
      candidate({ id: 'THERE', path: 'a.md', vault: 'other' }),
    ];
    expect(selectCandidates(publication({}), notes, 'main').included.map((n) => n.id)).toEqual([
      'HERE',
    ]);
    const scoped = selectCandidates(publication({ vaults: ['main', 'other'] }), notes, 'main');
    expect(scoped.included.map((n) => n.id)).toEqual(['HERE', 'THERE']);
  });

  it('an empty include admits every eligible note', () => {
    const pub = publication({ include: [] });
    const notes = [candidate({ id: 'A', path: 'anywhere/a.md' })];
    expect(selectCandidates(pub, notes, 'main').included.map((n) => n.id)).toEqual(['A']);
  });
});
