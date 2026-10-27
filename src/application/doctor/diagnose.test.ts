import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { showNote } from '../notes/show-note.js';
import { diagnose } from './diagnose.js';

describe('diagnose', () => {
  it('reports a clean vault as healthy with no findings', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\nSelf [[A]].\n');
    expect(unwrap(await diagnose(f.deps, f.vault))).toEqual({ ok: true, findings: [] });
  });

  it('names duplicate ids (error), dangling references and unidentified files', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: DUP\n---\n');
    f.fs.files.set('b.md', '---\nid: DUP\n---\nTo [[NOWHERE]].\n');
    f.fs.files.set('c.md', 'plain\n');
    f.fs.files.set('d.md', '---\nid: "bad id"\n---\n');

    const diagnosis = unwrap(await diagnose(f.deps, f.vault));
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
    expect(await showNote(f.deps, f.vault, 'DUP')).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });

  it('reports and repairs a stale index', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n');
    unwrap(await diagnose(f.deps, f.vault));
    f.fs.files.set('b.md', '---\nid: B\n---\n');
    const stale = unwrap(await diagnose(f.deps, f.vault));
    expect(stale.findings).toEqual([
      expect.objectContaining({
        kind: 'stale-index',
        severity: 'info',
        details: { added: ['b.md'], modified: [], removed: [] },
      }),
    ]);
    expect(unwrap(await diagnose(f.deps, f.vault)).findings).toEqual([]);
  });
});
