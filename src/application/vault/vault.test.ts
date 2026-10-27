import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { initVault, openVault } from './vault.js';

describe('initVault / openVault', () => {
  it('initializes with defaults and a generated id, then opens from a nested cwd', async () => {
    const f = fixture();
    const created = unwrap(await initVault(f.deps, { dir: '/proj/monitor-svc' }));
    expect(created.config).toMatchObject({
      id: 'ID1',
      name: 'monitor-svc',
      include: ['**/*.md'],
      identity: { strategy: 'ulid' },
    });
    const opened = unwrap(await openVault(f.deps, { cwd: '/proj/monitor-svc/docs/deep' }));
    expect(opened.root).toBe('/proj/monitor-svc');
  });

  it('refuses to re-initialize and validates the identity format', async () => {
    const f = fixture();
    expect(await initVault(f.deps, { dir: '/vault' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const bad = await initVault(f.deps, {
      dir: '/other',
      identity: { strategy: 'formatted', format: '{vault}-{date}' },
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(f.vaults.has('/other')).toBe(false);
  });

  it('reports NOT_FOUND when no vault is discoverable or the explicit root is wrong', async () => {
    const f = fixture();
    expect(await openVault(f.deps, { cwd: '/elsewhere' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await openVault(f.deps, { cwd: '/vault', root: '/nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
