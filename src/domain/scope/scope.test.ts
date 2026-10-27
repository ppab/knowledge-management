import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { asVaultId, defaultVaultConfig, type OpenVault } from '../vault/vault.js';
import { interleaveByRank } from './interleave.js';
import { mergeResolution, resolved } from './resolution.js';
import { availableVaults, resolveWriteTarget, unavailableRoots, type Scope } from './scope.js';

const vault = (root: string, name: string): OpenVault => ({
  root,
  config: defaultVaultConfig(asVaultId(name.toUpperCase()), name),
});
const open = (root: string, name: string) =>
  ({ available: true, root, vault: vault(root, name) }) as const;
const gone = (root: string) => ({ available: false, root, reason: 'missing' }) as const;

describe('resolveWriteTarget (invariant 7)', () => {
  const composite: Scope = {
    name: 'work',
    members: [open('/a', 'alpha'), open('/b', 'beta'), gone('/c')],
  };

  it('a single vault is always the target; a lone unavailable vault is an error', () => {
    expect(unwrap(resolveWriteTarget({ members: [open('/a', 'alpha')] })).root).toBe('/a');
    expect(resolveWriteTarget({ members: [gone('/c')] })).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });

  it('a composite scope needs a name, a path or a cwd inside exactly one member', () => {
    expect(resolveWriteTarget(composite)).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    expect(unwrap(resolveWriteTarget(composite, { vault: 'beta' })).root).toBe('/b');
    expect(unwrap(resolveWriteTarget(composite, { vault: '/a' })).root).toBe('/a');
    expect(unwrap(resolveWriteTarget(composite, { cwd: '/b/notes/deep' })).root).toBe('/b');
    expect(resolveWriteTarget(composite, { cwd: '/elsewhere' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(resolveWriteTarget(composite, { vault: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE', details: { vaults: ['alpha', 'beta', '/c'] } },
    });
    expect(resolveWriteTarget(composite, { vault: '/c' })).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });

  it('prefers the innermost member when vaults nest, and refuses duplicate names', () => {
    const nested: Scope = { members: [open('/a', 'x'), open('/a/inner', 'x')] };
    expect(unwrap(resolveWriteTarget(nested, { cwd: '/a/inner/doc' })).root).toBe('/a/inner');
    expect(resolveWriteTarget(nested, { vault: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(availableVaults(composite).map((v) => v.root)).toEqual(['/a', '/b']);
    expect(unavailableRoots(composite)).toEqual(['/c']);
  });
});

describe('mergeResolution (invariants 3 and 4, decision A6)', () => {
  const n = (id: string, path: string) => ({ id, title: path, path });

  it('prefers ids, then names, and reports ambiguity by kind', () => {
    expect(
      mergeResolution(
        [
          { vault: 'a', byId: [n('X', 'a.md')], byName: [n('Y', 'y.md')] },
          { vault: 'b', byId: [], byName: [n('Z', 'z.md')] },
        ],
        [],
      ),
    ).toEqual({ state: 'resolved', match: { vault: 'a', note: n('X', 'a.md') } });
    expect(
      mergeResolution(
        [
          { vault: 'a', byId: [n('X', 'a.md')], byName: [] },
          { vault: 'b', byId: [n('X', 'b.md')], byName: [] },
        ],
        [],
      ),
    ).toMatchObject({ state: 'ambiguous', by: 'id' });
    expect(
      mergeResolution(
        [
          { vault: 'a', byId: [], byName: [n('P', 'p.md')] },
          { vault: 'b', byId: [], byName: [n('Q', 'q.md')] },
        ],
        [],
      ),
    ).toMatchObject({ state: 'ambiguous', by: 'name' });
  });

  it('distinguishes a miss with unavailable vaults from a plain miss', () => {
    const none = [{ vault: 'a', byId: [], byName: [] }];
    expect(mergeResolution(none, ['/gone'])).toEqual({ state: 'unavailable', vaults: ['/gone'] });
    expect(mergeResolution(none, [])).toEqual({ state: 'not-found' });
    expect(resolved('q', mergeResolution(none, ['/gone']))).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
    expect(resolved('q', mergeResolution(none, []))).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('interleaveByRank (decision A10)', () => {
  it('takes rank 1 from every vault, then rank 2, in scope order', () => {
    expect(interleaveByRank([['a1', 'a2', 'a3'], [], ['c1']])).toEqual(['a1', 'c1', 'a2', 'a3']);
    expect(interleaveByRank([])).toEqual([]);
  });
});
