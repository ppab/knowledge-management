import { describe, expect, it } from 'vitest';
import type { Publication } from '../../domain/publishing/publication.js';
import { releaseTagName } from '../../domain/release/release-tag.js';
import { unwrap } from '../../domain/result.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { buildRegistry } from '../plugin/registry.js';
import { release, type ReleaseInput } from './release.js';

const publication = (name: string): Publication => ({
  name,
  destination: { kind: 'markdown', options: {} },
  output: '/out/site',
  route: '/{{slug}}/',
  include: [],
  exclude: [],
  references: 'fail',
});

const setup = (...names: string[]): Fixture =>
  fixture({ publications: Object.fromEntries(names.map((n) => [n, publication(n)])) });

const run = (f: Fixture, input: ReleaseInput) =>
  release(f.deps, f.scope, unwrap(buildRegistry([], f.scope)), input);

const tagOf = (f: Fixture, name: string) => releaseTagName(name, f.deps.clock.now());

describe('release', () => {
  it('tags the checked-out commit and pushes the tag to the only remote', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault', { commit: 'c'.repeat(40), remotes: ['upstream'] });
    const outcome = unwrap(await run(f, { name: 'ppab' }));
    expect(outcome).toMatchObject({
      kind: 'released',
      tag: tagOf(f, 'ppab'),
      commit: 'c'.repeat(40),
      remote: 'upstream',
      uncommitted: false,
    });
    expect(outcome.tag).toMatch(/^release\/ppab\/\d{8}T\d{6}Z$/);
    expect(f.releases.tags).toEqual([
      { root: '/vault', name: outcome.tag, message: 'Release ppab' },
    ]);
    expect(f.releases.pushed).toEqual([{ root: '/vault', remote: 'upstream', tag: outcome.tag }]);
    // A release marks the repository; it publishes nothing.
    expect(f.outputs.files.size).toBe(0);
  });

  it('prefers origin among several remotes and honours --remote', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault', { remotes: ['backup', 'origin'] });
    expect(unwrap(await run(f, { name: 'ppab', dryRun: true })).remote).toBe('origin');
    expect(unwrap(await run(f, { name: 'ppab', remote: 'backup', dryRun: true })).remote).toBe(
      'backup',
    );
  });

  it('a dry run creates and pushes nothing', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault', { uncommitted: true });
    const outcome = unwrap(await run(f, { name: 'ppab', dryRun: true }));
    expect(outcome).toMatchObject({ kind: 'planned', remote: 'origin', uncommitted: true });
    expect(f.releases.tags).toEqual([]);
    expect(f.releases.pushed).toEqual([]);
  });

  it('push: false tags without needing a remote', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault', { remotes: [] });
    const outcome = unwrap(await run(f, { name: 'ppab', push: false }));
    expect(outcome.kind).toBe('tagged');
    expect(outcome.remote).toBeUndefined();
    expect(f.releases.tags).toHaveLength(1);
    expect(f.releases.pushed).toEqual([]);
  });

  it('refuses before tagging when there is no usable remote', async () => {
    const none = setup('ppab');
    none.releases.enable('/vault', { remotes: [] });
    expect(await run(none, { name: 'ppab' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(none.releases.tags).toEqual([]);

    const several = setup('ppab');
    several.releases.enable('/vault', { remotes: ['a', 'b'] });
    expect(await run(several, { name: 'ppab' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE', details: { remotes: ['a', 'b'] } },
    });
    expect(await run(several, { name: 'ppab', remote: 'c' })).toMatchObject({
      ok: false,
      error: { code: 'USAGE' },
    });
    expect(several.releases.tags).toEqual([]);
  });

  it('refuses a name that is not a publication in the config, naming the defined ones', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault');
    const result = await run(f, { name: 'nope' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { names: ['ppab'] } },
    });
    expect(f.releases.tags).toEqual([]);
  });

  it('refuses a vault no repository holds', async () => {
    const f = setup('ppab');
    expect(await run(f, { name: 'ppab' })).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });

  it('refuses a publication name a tag cannot carry', async () => {
    const f = setup('my site');
    f.releases.enable('/vault');
    expect(await run(f, { name: 'my site' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(f.releases.tags).toEqual([]);
  });

  it('a second release in the same second conflicts', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault');
    unwrap(await run(f, { name: 'ppab' }));
    expect(await run(f, { name: 'ppab' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(f.releases.pushed).toHaveLength(1);
  });

  it('a failed push keeps the tag and says how to send it', async () => {
    const f = setup('ppab');
    f.releases.enable('/vault');
    f.releases.rejectNextPush('remote unreachable');
    const result = await run(f, { name: 'ppab' });
    const tag = tagOf(f, 'ppab');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', details: { tag, remote: 'origin' } },
    });
    if (!result.ok) {
      expect(result.error.message).toContain('remote unreachable');
      expect(result.error.message).toContain(`git push origin ${tag}`);
    }
    expect(f.releases.tags).toHaveLength(1);
  });
});
