import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { adoptNote } from './adopt-note.js';

describe('adoptNote', () => {
  it('adds only an id to existing frontmatter, keeping comments, order and unknown keys', async () => {
    const f = fixture();
    f.fs.files.set(
      'a.md',
      '# leading comment\n---\n# c1\ntitle: A # c2\nextra:\n  - x\n---\nBody\n',
    );
    // The file above has no frontmatter (it does not start with ---), so it gets a new block.
    f.fs.files.set('b.md', '---\n# c1\ntitle: B # c2\nextra:\n  - x\n---\nBody\n');

    const b = unwrap(await adoptNote(f.deps, f.vault, { path: 'b.md' }));
    expect(b.id).toBe('ID1');
    expect(f.fs.files.get('b.md')).toBe(
      '---\n# c1\ntitle: B # c2\nextra:\n  - x\nid: ID1\n---\nBody\n',
    );

    const a = unwrap(await adoptNote(f.deps, f.vault, { path: './a.md' }));
    expect(a.id).toBe('ID2');
    expect(f.fs.files.get('a.md')).toBe(
      '---\nid: ID2\n---\n# leading comment\n---\n# c1\ntitle: A # c2\nextra:\n  - x\n---\nBody\n',
    );
  });

  it('needs a type for {type} formats: frontmatter first, then --type, else a clear error', async () => {
    const f = fixture({ identity: { strategy: 'formatted', format: '{type}-{ulid}' } });
    f.fs.files.set('typed.md', '---\ntype: ADR\n---\n');
    f.fs.files.set('plain.md', 'text\n');
    expect(unwrap(await adoptNote(f.deps, f.vault, { path: 'typed.md', type: 'ignored' })).id).toBe(
      'ADR-ID1',
    );
    expect(unwrap(await adoptNote(f.deps, f.vault, { path: 'plain.md', type: 'memo' })).id).toBe(
      'memo-ID2',
    );
    f.fs.files.set('other.md', 'text\n');
    expect(await adoptNote(f.deps, f.vault, { path: 'other.md' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('--type') as string },
    });
  });

  it('refuses files that already have an id or have an invalid one', async () => {
    const f = fixture();
    f.fs.files.set('has.md', '---\nid: X1\n---\n');
    f.fs.files.set('bad.md', '---\nid: "a b"\n---\n');
    expect(await adoptNote(f.deps, f.vault, { path: 'has.md' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await adoptNote(f.deps, f.vault, { path: 'bad.md' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await adoptNote(f.deps, f.vault, { path: 'missing.md' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
