import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { relabelAll, relabelReferences } from './relabel.js';

const B = '---\nid: B\ntitle: Beta\n---\n';
const C = '---\nid: C\ntitle: Gamma\n---\n';

describe('relabelReferences', () => {
  it('refreshes standalone links to each target current title: bare and stale-labelled alike', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\n## References\n\n- [[B]]\n- [[C|Old Name]]\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    f.fs.files.set('c.md', C);
    const out = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A' }));
    expect(out.written).toBe(true);
    expect(f.fs.files.get('a.md')).toBe(
      '---\nid: A\n---\n\n## References\n\n- [[B|Beta]]\n- [[C|Gamma]]\n',
    );
  });

  it('leaves inline references woven into prose untouched', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\nSee [[B]] and also [[C|the gamma]] today.\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    f.fs.files.set('c.md', C);
    const out = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A' }));
    expect(out.written).toBe(false);
    expect(f.fs.files.get('a.md')).toBe(A);
  });

  it('overwrites a hand-labelled standalone link (accepted heuristic mis-guess)', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\n[[B|On purpose]]\n';
    f.fs.files.set('a.md', A);
    f.fs.files.set('b.md', B);
    const out = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A' }));
    expect(out.written).toBe(true);
    expect(f.fs.files.get('a.md')).toBe('---\nid: A\n---\n\n[[B|Beta]]\n');
  });

  it('leaves a standalone link whose target does not resolve in scope', async () => {
    const f = fixture();
    const A = '---\nid: A\n---\n\n[[Z]]\n'; // Z is a valid id shape, but no such note exists
    f.fs.files.set('a.md', A);
    const out = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A' }));
    expect(out.written).toBe(false);
    expect(f.fs.files.get('a.md')).toBe(A);
  });

  it('is a no-op when a standalone link already shows the current title', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n\n[[B|Beta]]\n');
    f.fs.files.set('b.md', B);
    const out = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A' }));
    expect(out.written).toBe(false);
    expect(f.fs.writes).toEqual([]);
  });

  it('previews with --dry-run and writes nothing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n\n[[B]]\n');
    f.fs.files.set('b.md', B);
    const dry = unwrap(await relabelReferences(f.deps, f.scope, { source: 'A', dryRun: true }));
    expect(dry.written).toBe(false);
    expect(dry.diff).toContain('+[[B|Beta]]');
    expect(f.fs.writes).toEqual([]);
  });
});

describe('relabelAll', () => {
  it('relabels standalone links across every note in the scope, leaving linkless notes alone', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n\n[[B]]\n');
    f.fs.files.set('b.md', '---\nid: B\ntitle: Beta\n---\n\n[[C|stale]]\n');
    f.fs.files.set('c.md', C);
    const out = unwrap(await relabelAll(f.deps, f.scope));
    expect(out.scanned).toBe(3);
    expect(out.outcomes.map((o) => o.path).sort()).toEqual(['a.md', 'b.md']);
    expect(f.fs.files.get('a.md')).toBe('---\nid: A\n---\n\n[[B|Beta]]\n');
    expect(f.fs.files.get('b.md')).toBe('---\nid: B\ntitle: Beta\n---\n\n[[C|Gamma]]\n');
    expect(f.fs.files.get('c.md')).toBe(C); // no links, untouched
  });

  it('dry-run across the scope reports the diffs and writes nothing', async () => {
    const f = fixture();
    f.fs.files.set('a.md', '---\nid: A\n---\n\n[[B]]\n');
    f.fs.files.set('b.md', B);
    const out = unwrap(await relabelAll(f.deps, f.scope, { dryRun: true }));
    expect(out.outcomes).toHaveLength(1);
    expect(out.outcomes[0]!.diff).toContain('+[[B|Beta]]');
    expect(f.fs.writes).toEqual([]);
  });
});
