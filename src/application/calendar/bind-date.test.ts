import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { listNotes } from '../notes/list-notes.js';
import { bindDate } from './bind-date.js';

describe('bindDate', () => {
  it('adds a date once, keeps the rest of the file intact, and removes it again', async () => {
    const f = fixture();
    const source = '---\n# note\nid: A\ntitle: Alpha # t\nextra: [1, 2]\n---\n\nBody [[B]].\n';
    f.fs.files.set('a.md', source);

    unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-10-23' }));
    const bound = source.replace('extra: [1, 2]\n', 'extra: [1, 2]\ndates:\n  - 2026-10-23\n');
    expect(f.fs.files.get('a.md')).toBe(bound);
    expect(
      unwrap(await listNotes(f.deps, f.scope, { date: '2026-10-23' })).map((e) => e.path),
    ).toEqual(['a.md']);

    // Twice is a no-op, as is removing an absent date.
    expect(unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-10-23' })).written).toBe(
      false,
    );
    expect(
      unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '1999-01-01', remove: true }))
        .written,
    ).toBe(false);
    expect(f.fs.writes).toHaveLength(1);

    unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-01-01' }));
    expect(f.fs.files.get('a.md')).toContain('dates:\n  - 2026-01-01\n  - 2026-10-23\n');
    unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-10-23', remove: true }));
    unwrap(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-01-01', remove: true }));
    expect(f.fs.files.get('a.md')).toBe(source);
  });

  it('validates the date and previews with dry-run', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n');
    expect(await bindDate(f.deps, f.scope, { note: 'A', date: '2026-13-01' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const preview = unwrap(
      await bindDate(f.deps, f.scope, { note: 'A', date: '2026-10-23', dryRun: true }),
    );
    expect(preview.diff).toContain('+dates:\n+  - 2026-10-23\n');
    expect(f.fs.writes).toEqual([]);
  });
});
