import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { showNote } from '../notes/show-note.js';
import type { NotePlugin } from '../plugin/plugin.js';
import { buildRegistry } from '../plugin/registry.js';
import { diagnose } from './diagnose.js';

describe('diagnose', () => {
  it('reports a clean vault as healthy with no findings', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\nSelf [[A]].\n');
    expect(unwrap(await diagnose(f.deps, f.scope))).toEqual({ ok: true, findings: [] });
  });

  it('names duplicate ids (error), dangling references and unidentified files', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: DUP\n---\n');
    f.fs.files.set('b.md', '---\nid: DUP\n---\nTo [[NOWHERE]].\n');
    f.fs.files.set('c.md', 'plain\n');
    f.fs.files.set('d.md', '---\nid: "bad id"\n---\n');

    const diagnosis = unwrap(await diagnose(f.deps, f.scope));
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.findings.map((x) => [x.kind, x.severity])).toEqual([
      ['duplicate-id', 'error'],
      ['dangling-reference', 'warning'],
      ['unidentified', 'info'],
      ['unidentified', 'info'],
    ]);
    expect(diagnosis.findings[0]).toMatchObject({
      message: expect.stringContaining('a.md, b.md') as string,
      details: { id: 'DUP', paths: ['a.md', 'b.md'] },
    });
    expect(diagnosis.findings[3]!.message).toContain('must not contain whitespace');
    expect(await showNote(f.deps, f.scope, 'DUP')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('reports and repairs a stale index', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n');
    unwrap(await diagnose(f.deps, f.scope));
    f.fs.files.set('b.md', '---\nid: B\n---\n');
    const stale = unwrap(await diagnose(f.deps, f.scope));
    expect(stale.findings).toEqual([
      expect.objectContaining({
        kind: 'stale-index',
        severity: 'info',
        details: { added: ['b.md'], modified: [], removed: [] },
      }),
    ]);
    expect(unwrap(await diagnose(f.deps, f.scope)).findings).toEqual([]);
  });

  it('validates declared fields of owned types only where the plugin is enabled', async () => {
    const plugin: NotePlugin = {
      name: 'todos',
      description: 'todos',
      types: ['todo'],
      fields: [
        { name: 'status', type: 'enum', values: ['open', 'done'], required: true },
        { name: 'due', type: 'date' },
      ],
    };
    const f = fixture({ plugins: { todos: {} } });
    const work = f.addVault('/work', 'work');
    f.fs.files.set('ok.md', '---\nid: OK\ntype: todo\nstatus: open\n---\n');
    f.fs.files.set('bad.md', '---\nid: BAD\ntype: todo\nstatus: later\ndue: soon\nextra: 1\n---\n');
    f.fs.files.set('missing.md', '---\nid: MISSING\ntype: todo\n---\n');
    f.fs.files.set('other.md', '---\nid: OTHER\ntype: note\nstatus: later\n---\n');
    work.fs.files.set('w.md', '---\nid: W\ntype: todo\nstatus: later\n---\n');
    const scope = f.scopeOf('/vault', '/work');
    const registry = unwrap(buildRegistry([plugin], scope));

    const diagnosis = unwrap(await diagnose(f.deps, scope, registry));
    expect(diagnosis.ok).toBe(true); // field problems are never errors
    expect(
      diagnosis.findings.map((x) => [x.kind, x.severity, x.vault, x.details.path, x.details.field]),
    ).toEqual([
      ['field', 'warning', 'monitor', 'bad.md', 'status'],
      ['field', 'warning', 'monitor', 'bad.md', 'due'],
      ['field', 'info', 'monitor', 'bad.md', 'extra'],
      ['field', 'warning', 'monitor', 'missing.md', 'status'],
    ]);
    expect(diagnosis.findings[0]).toMatchObject({
      message: 'bad.md (todo): "status" must be one of open, done, got "later"',
      details: { plugin: 'todos', problem: 'enum', allowed: ['open', 'done'] },
    });
    // Without a registry, nothing about fields is checked.
    expect(unwrap(await diagnose(f.deps, scope)).findings).toEqual([]);
  });
});
