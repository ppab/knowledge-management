import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { diagnose } from '../doctor/diagnose.js';
import { listNotes } from '../notes/list-notes.js';
import { showNote } from '../notes/show-note.js';
import { addReference } from '../references/add-reference.js';
import { backlinks, listReferences } from '../references/references.js';
import { searchNotes } from '../search/search-notes.js';
import { loadScope } from '../vault/vault.js';
import { describeScope, listScopes } from './scope-info.js';

const note = (id: string, title: string, extra = '', body = '') =>
  `---\nid: ${id}\ntitle: ${title}\n${extra}---\n${body}`;

/** Two vaults plus one that is missing: the shape every scope test needs. */
const twoVaults = () => {
  const f = fixture();
  const work = f.addVault('/work', 'work');
  f.fs.files.set('a.md', note('A', 'Alpha', 'aliases: [shared]\n', 'Alpha mentions [[W]].\n'));
  f.fs.files.set('dup.md', note('DUP', 'Dup in monitor'));
  work.fs.files.set(
    'w.md',
    note('W', 'Work note', 'aliases: [shared]\n', 'Back to [[A]] and [[GONE]].\n'),
  );
  work.fs.files.set('dup.md', note('DUP', 'Dup in work'));
  return {
    f,
    work,
    scope: f.scopeOf('/vault', '/work'),
    partial: f.scopeOf('/vault', { root: '/gone', reason: 'missing' }),
  };
};

describe('resolution across a scope', () => {
  it('finds a note in any vault by id and reports which vault owns it', async () => {
    const { f, scope } = twoVaults();
    const found = unwrap(await showNote(f.deps, scope, 'W'));
    expect(found.vault.config.name).toBe('work');
    expect(found.note.title).toBe('Work note');
    expect(unwrap(await showNote(f.deps, scope, 'Work note')).vault.root).toBe('/work');
  });

  it('is ambiguous for an id or alias present in two vaults (invariants 3 and 4)', async () => {
    const { f, scope } = twoVaults();
    expect(await showNote(f.deps, scope, 'DUP')).toMatchObject({
      ok: false,
      error: {
        code: 'AMBIGUOUS',
        details: {
          candidates: [
            expect.objectContaining({ vault: 'monitor' }),
            expect.objectContaining({ vault: 'work' }),
          ],
        },
      },
    });
    expect(await showNote(f.deps, scope, 'shared')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
    // Each vault on its own is unambiguous.
    expect(unwrap(await showNote(f.deps, f.scopeOf('/work'), 'DUP')).note.title).toBe(
      'Dup in work',
    );
  });

  it('reports a miss as unavailable when a vault could not be opened (A6), else not found', async () => {
    const { f, scope, partial } = twoVaults();
    expect(await showNote(f.deps, partial, 'nope')).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE', details: { vaults: ['/gone'] } },
    });
    expect(await showNote(f.deps, scope, 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    // Reads of the available vault still work.
    expect(unwrap(await showNote(f.deps, partial, 'A')).note.title).toBe('Alpha');
  });
});

describe('federated reads', () => {
  it('lists and searches across vaults, interleaving by rank and tagging each hit', async () => {
    const { f, work, scope } = twoVaults();
    work.fs.files.set('w2.md', note('W2', 'Second work note', '', 'alpha alpha alpha\n'));
    expect(unwrap(await listNotes(f.deps, scope)).map((e) => [e.vault, e.path])).toEqual([
      ['monitor', 'a.md'],
      ['monitor', 'dup.md'],
      ['work', 'dup.md'],
      ['work', 'w.md'],
      ['work', 'w2.md'],
    ]);
    const hits = unwrap(await searchNotes(f.deps, scope, 'alpha'));
    expect(hits.map((h) => [h.vault, h.entry.path, h.rankInVault])).toEqual([
      ['monitor', 'a.md', 1],
      ['work', 'w2.md', 1],
    ]);
    expect(unwrap(await searchNotes(f.deps, scope, 'alpha', { limit: 1 }))).toHaveLength(1);
  });

  it('follows references across vaults for backlinks and reference listings', async () => {
    const { f, scope, partial } = twoVaults();
    const back = unwrap(await backlinks(f.deps, scope, 'A'));
    expect(back.backlinks.map((b) => [b.vault, b.source.path])).toEqual([['work', 'w.md']]);
    expect(unwrap(await backlinks(f.deps, f.scopeOf('/vault'), 'A')).backlinks).toEqual([]);

    const refs = unwrap(await listReferences(f.deps, scope, 'W'));
    expect(refs.references.map((r) => [r.target, r.resolution.state])).toEqual([
      ['A', 'resolved'],
      ['GONE', 'unresolved'],
    ]);
    const partialRefs = unwrap(await listReferences(f.deps, partial, 'A'));
    expect(partialRefs.references[0]?.resolution).toEqual({
      state: 'unavailable',
      vaults: ['/gone'],
    });
  });

  it('adds a reference to a note in another vault, writing the canonical id', async () => {
    const { f, work, scope } = twoVaults();
    unwrap(await addReference(f.deps, scope, { source: 'Work note', target: 'Alpha' }));
    expect(work.fs.files.get('w.md')).toContain('\n[[A]]\n');
    expect(f.fs.writes).toEqual([]);
    expect(await addReference(f.deps, scope, { source: 'W', target: 'shared' })).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('doctor names unavailable vaults and ignores references that resolve in a sibling vault', async () => {
    const { f, scope, partial } = twoVaults();
    const full = unwrap(await diagnose(f.deps, scope));
    expect(full.findings.map((x) => [x.vault, x.kind])).toEqual([
      ['work', 'dangling-reference'],
      ['scope', 'duplicate-id'],
    ]);
    const some = unwrap(await diagnose(f.deps, partial));
    expect(some.ok).toBe(false);
    expect(some.findings[0]).toMatchObject({
      kind: 'unavailable-vault',
      severity: 'error',
      vault: '/gone',
    });
    // Alone, monitor's [[W]] dangles.
    expect(some.findings.map((x) => x.kind)).toContain('dangling-reference');
  });
});

describe('loadScope', () => {
  it('prefers explicit roots, then a named scope, then the nearest vault', async () => {
    const f = fixture();
    f.addVault('/work', 'work');
    f.userConfig.scopes.all = { vaults: ['/vault', '/work', '/gone'] };

    const explicit = unwrap(await loadScope(f.deps, { cwd: '/x', vaults: ['/work'] }));
    expect(describeScope(explicit)).toEqual({
      members: [{ root: '/work', available: true, name: 'work', id: 'WORK' }],
    });

    const named = unwrap(await loadScope(f.deps, { cwd: '/x', scope: 'all' }));
    expect(describeScope(named)).toMatchObject({
      name: 'all',
      members: [
        { root: '/vault', available: true },
        { root: '/work', available: true },
        { root: '/gone', available: false },
      ],
    });

    const nearest = unwrap(await loadScope(f.deps, { cwd: '/work/deep' }));
    expect(nearest.members.map((m) => m.root)).toEqual(['/work']);

    expect(await loadScope(f.deps, { cwd: '/x', scope: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { scopes: ['all'] } },
    });
    expect(await loadScope(f.deps, { cwd: '/x', scope: 'all', vaults: ['/work'] })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(await loadScope(f.deps, { cwd: '/nowhere' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(unwrap(await listScopes(f.deps)).scopes).toEqual([
      { name: 'all', vaults: ['/vault', '/work', '/gone'] },
    ]);
  });
});
