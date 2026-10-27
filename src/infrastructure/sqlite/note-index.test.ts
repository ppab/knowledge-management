import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadNoteEntry } from '../../application/notes/load-note.js';
import { unwrap } from '../../domain/result.js';
import { createMarkdownParser } from '../markdown/parser.js';
import { createFrontmatterCodec } from '../yaml/frontmatter-codec.js';
import { openSqlite } from './driver.js';
import {
  createSqliteIndexProvider,
  createSqliteNoteIndex,
  toMatchExpression,
} from './note-index.js';

const deps = { markdown: createMarkdownParser(), frontmatter: createFrontmatterCodec() };
const entry = (path: string, source: string) =>
  loadNoteEntry(deps, { path, source, version: path });
const file = (path: string) => ({ path, mtime: 1, size: 1 });

describe('sqlite note index', () => {
  it('stores and queries notes, aliases, dates, fields and references', () => {
    const index = createSqliteNoteIndex(openSqlite(':memory:'));
    index.upsert(
      entry(
        'a.md',
        '---\nid: A\ntitle: Alpha\naliases: [Al]\ndates: [2026-10-01, 2026-10-02]\ntags: [t]\nstatus: open\nsteps: [x, y]\n---\nSee [[B]] and [[C|see]].\n',
      ),
      file('a.md'),
    );
    index.upsert(
      entry('b.md', '---\nid: B\ndates: [2026-10-02]\nstatus: done\n---\n'),
      file('b.md'),
    );
    index.upsert(entry('u.md', 'no id, see [[A]]\n'), file('u.md'));

    expect(index.all().map((e) => e.kind)).toEqual(['note', 'note', 'unidentified']);
    expect(index.byId('A')[0]).toMatchObject({
      title: 'Alpha',
      aliases: ['Al'],
      tags: ['t'],
      fields: { status: 'open', steps: ['x', 'y'] },
    });
    expect(index.byName('al').map((e) => e.path)).toEqual(['a.md']);
    expect(index.byName('ALPHA').map((e) => e.path)).toEqual(['a.md']);
    expect(index.byPath('u.md')?.kind).toBe('unidentified');
    expect(index.byPath('zzz')).toBeNull();
    expect(index.byField('status').map((e) => e.path)).toEqual(['a.md', 'b.md']);
    expect(index.byField('status', 'done').map((e) => e.path)).toEqual(['b.md']);
    expect(index.byField('steps', 'y').map((e) => e.path)).toEqual(['a.md']);
    expect(index.onDate('2026-10-02').map((e) => e.path)).toEqual(['a.md', 'b.md']);
    expect(index.datesBetween('2026-10-01', '2026-10-01').map((h) => h.entry.path)).toEqual([
      'a.md',
    ]);
    expect(index.outgoing('a.md').map((r) => [r.target, r.label ?? null])).toEqual([
      ['B', null],
      ['C', 'see'],
    ]);
    expect(index.backlinks('A').map((r) => r.sourcePath)).toEqual(['u.md']);
    expect(index.dangling().map((r) => r.target)).toEqual(['C']);
    expect(index.stats()).toEqual({ notes: 3, unidentified: 1, references: 3, schemaVersion: 1 });

    index.remove('a.md');
    expect(index.byId('A')).toEqual([]);
    expect(index.byField('status').map((e) => e.path)).toEqual(['b.md']);
    expect(index.search('alpha', 10)).toEqual([]);
    expect(index.stats().references).toBe(1);
    index.close();
  });

  it('resets itself when the schema version changes', () => {
    const driver = openSqlite(':memory:');
    const v1 = createSqliteNoteIndex(driver, { schemaVersion: 1, closeDriver: false });
    v1.upsert(entry('a.md', '---\nid: A\n---\n'), file('a.md'));
    v1.close();
    const again = createSqliteNoteIndex(driver, { schemaVersion: 1, closeDriver: false });
    expect(again.stats().notes).toBe(1);
    again.close();
    const v2 = createSqliteNoteIndex(driver, { schemaVersion: 2, closeDriver: false });
    expect(v2.stats()).toMatchObject({ notes: 0, schemaVersion: 2 });
    v2.close();
    driver.close();
  });

  it('never lets query text become FTS syntax', () => {
    expect(toMatchExpression('hello world')).toBe('"hello" "world"');
    expect(toMatchExpression('kube*')).toBe('"kube"*');
    expect(toMatchExpression('a OR b NOT c')).toBe('"a" "OR" "b" "NOT" "c"');
    expect(toMatchExpression('say "hi" title:x (y)')).toBe('"say" """hi""" "title:x" "(y)"');
    expect(toMatchExpression('  * ')).toBeNull();

    const index = createSqliteNoteIndex(openSqlite(':memory:'));
    index.upsert(
      entry('a.md', '---\nid: A\ntitle: Alpha\n---\nbody (text) "quoted" x:y\n'),
      file('a.md'),
    );
    for (const q of ['(text)', '"quoted"', 'x:y', 'NOT', 'alpha OR', 'col: *']) {
      expect(() => index.search(q, 5)).not.toThrow();
    }
    expect(index.search('"quoted"', 5)).toHaveLength(1);
    index.close();
  });

  it('batches in a transaction that rolls back on failure', () => {
    const index = createSqliteNoteIndex(openSqlite(':memory:'));
    expect(() =>
      index.batch(() => {
        index.upsert(entry('a.md', '---\nid: A\n---\n'), file('a.md'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(index.stats().notes).toBe(0);
    index.close();
  });
});

describe('sqlite index provider', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'notes-idx-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('creates every file under .notes/cache and persists across opens', async () => {
    const provider = createSqliteIndexProvider();
    const first = unwrap(await provider.open(root));
    first.upsert(entry('a.md', '---\nid: A\n---\n'), file('a.md'));
    first.close();
    const second = unwrap(await provider.open(root));
    expect(second.stats().notes).toBe(1);
    second.close();
    expect(await readdir(root)).toEqual(['.notes']);
    expect(await readdir(join(root, '.notes'))).toEqual(['cache']);
    expect(await readdir(join(root, '.notes', 'cache'))).toContain('index.sqlite');
  });
});
