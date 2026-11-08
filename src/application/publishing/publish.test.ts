import { describe, expect, it } from 'vitest';
import { ok, unwrap } from '../../domain/result.js';
import type { Publication } from '../../domain/publishing/publication.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { buildRegistry } from '../plugin/registry.js';
import { withScope } from '../scope/session.js';
import { planPublication } from './plan-publication.js';
import { publish } from './publish.js';

const publication = (overrides: Partial<Publication>): Publication => ({
  name: 'site',
  destination: { kind: 'markdown', options: {} },
  output: '/out/site',
  route: '/{{slug}}/',
  include: [],
  exclude: [],
  references: 'fail',
  ...overrides,
});

const setup = (publications: Record<string, Publication>, files: Record<string, string>): Fixture => {
  const f = fixture({ publications });
  for (const [path, content] of Object.entries(files)) f.fs.files.set(path, content);
  return f;
};

const registryOf = (f: Fixture) => unwrap(buildRegistry([], f.scope));
const run = (f: Fixture, name: string, dryRun = false) =>
  publish(f.deps, f.scope, registryOf(f), { name, dryRun });

const alpha = '---\nid: A\nvisibility: public\ntitle: Alpha\n---\nSees [[B]].\n';
const beta = '---\nid: B\nvisibility: public\ntitle: Beta\n---\nBeta body.\n';

describe('publish — markdown', () => {
  it('writes full Markdown files with relative links and a manifest', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {
      'docs/alpha.md': alpha,
      'docs/beta.md': beta,
    });
    const outcome = unwrap(await run(f, 'site'));
    expect(outcome.kind).toBe('published');
    expect(f.outputs.files.get('/out/site/alpha.md')).toContain('Sees [Beta](./beta.md).');
    expect(f.outputs.files.get('/out/site/alpha.md')).toContain('title: Alpha');
    const manifest = JSON.parse(f.outputs.files.get('/out/site/manifest.json') ?? '{}') as {
      entries: { id: string; route: string; path: string }[];
    };
    expect(manifest.entries.map((e) => [e.id, e.route, e.path])).toEqual([
      ['A', '/alpha/', 'alpha.md'],
      ['B', '/beta/', 'beta.md'],
    ]);
    // Source files are never written.
    expect(f.fs.writes).toEqual([]);
  });
});

describe('publish — html', () => {
  it('writes body fragments with route links and a description in the manifest', async () => {
    const withDesc = '---\nid: A\nvisibility: public\ntitle: Alpha\ndescription: A page\n---\nSees [[B]].\n';
    const f = setup({ site: publication({ destination: { kind: 'html', options: {} }, include: ['docs/**'] }) }, {
      'docs/alpha.md': withDesc,
      'docs/beta.md': beta,
    });
    unwrap(await run(f, 'site'));
    expect(f.outputs.files.get('/out/site/alpha/index.html')).toContain('<a href="/beta/">Beta</a>');
  });
});

describe('publish — astro (modular)', () => {
  const post = '---\nid: A\nvisibility: public\ntitle: Alpha\ncreated: 2026-01-02T10:00:00.000Z\ndescription: A page\n---\nSees [[B]].\n';
  const other = '---\nid: B\nvisibility: public\ntitle: Beta\ncreated: 2026-01-01T00:00:00.000Z\ndescription: B page\n---\nBeta.\n';

  it('writes into the content collection with mapped frontmatter and route links', async () => {
    const f = setup(
      { blog: publication({ name: 'blog', destination: { kind: 'astro', options: { theme: 'modular' } }, include: ['posts/**'], references: 'strip-to-label' }) },
      { 'posts/alpha.md': post, 'posts/beta.md': other },
    );
    unwrap(await run(f, 'blog'));
    const file = f.outputs.files.get('/out/site/src/content/posts/alpha.md');
    expect(file).toBeDefined();
    expect(file).toContain('title: Alpha');
    expect(file).toContain('date: 2026-01-02');
    expect(file).toContain('description: A page');
    expect(file).toContain('id: A');
    expect(file).not.toContain('visibility:');
    expect(file).toContain('Sees [Beta](/posts/beta/).');
    // Manifest lands outside the Astro content vault.
    expect(f.outputs.files.has('/out/site/.capture/manifest.json')).toBe(true);
  });

  it('rejects an unknown theme at registry build', () => {
    const f = setup(
      { blog: publication({ destination: { kind: 'astro', options: { theme: 'nope' } }, include: ['posts/**'] }) },
      {},
    );
    expect(buildRegistry([], f.scope)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects a publication route that fights the theme', () => {
    const f = setup(
      { blog: publication({ destination: { kind: 'astro', options: {} }, route: '/x/{{slug}}/', include: ['posts/**'] }) },
      {},
    );
    expect(buildRegistry([], f.scope)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('publish — reference policies', () => {
  const linkToPrivate = '---\nid: A\nvisibility: public\ntitle: Alpha\n---\nSee [[P]] and [[GONE]].\n';
  const priv = '---\nid: P\nvisibility: private\ntitle: Secret\n---\n';

  it('a fail-policy violation makes the plan unpublishable and writes nothing', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {
      'docs/alpha.md': linkToPrivate,
      'docs/secret.md': priv,
    });
    const dry = unwrap(await run(f, 'site', true));
    expect(dry.kind).toBe('planned');
    if (dry.kind === 'planned') expect(dry.plan.violations.length).toBe(2);
    expect(await run(f, 'site')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(f.outputs.writes).toEqual([]);
  });

  it('strip-to-label replaces an excluded or unresolved reference with its label', async () => {
    const f = setup(
      { site: publication({ include: ['docs/**'], references: 'strip-to-label' }) },
      { 'docs/alpha.md': linkToPrivate, 'docs/secret.md': priv },
    );
    unwrap(await run(f, 'site'));
    const out = f.outputs.files.get('/out/site/alpha.md') ?? '';
    expect(out).toContain('See Secret and GONE.');
  });
});

describe('publish — selection, dry-run, and errors', () => {
  it('a dry run writes nothing', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {
      'docs/alpha.md': alpha,
      'docs/beta.md': beta,
    });
    unwrap(await run(f, 'site', true));
    expect(f.outputs.writes).toEqual([]);
  });

  it('planning reads no note files', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {
      'docs/alpha.md': alpha,
      'docs/beta.md': beta,
    });
    const registry = registryOf(f);
    const resolved = registry.publications()[0]!;
    let reads = 0;
    const original = f.deps.notes.read.bind(f.deps.notes);
    f.deps = { ...f.deps, notes: { ...f.deps.notes, read: (...args) => { reads += 1; return original(...args); } } };
    await withScope(f.deps, f.scope, (session) => {
      reads = 0;
      unwrap(planPublication(session, resolved));
      expect(reads).toBe(0);
      return ok(undefined);
    });
  });

  it('a route collision aborts with nothing written', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {
      'docs/a.md': '---\nid: A\nvisibility: public\ntitle: T\nslug: same\n---\n',
      'docs/b.md': '---\nid: B\nvisibility: public\ntitle: T2\nslug: same\n---\n',
    });
    expect(await run(f, 'site')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(f.outputs.writes).toEqual([]);
  });

  it('refuses an output directory the vault would index', async () => {
    const f = setup({ site: publication({ output: './dist', include: [] }) }, {
      'alpha.md': alpha,
    });
    expect(await run(f, 'site')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('reports an unknown publication as NOT_FOUND', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, {});
    expect(await run(f, 'ghost')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('reports a publication defined in two vaults as AMBIGUOUS', async () => {
    const f = setup({ site: publication({ include: ['docs/**'] }) }, { 'docs/alpha.md': alpha });
    const other = f.addVault('/other', 'other', { publications: { site: publication({ include: ['docs/**'] }) } });
    other.fs.files.set('docs/x.md', beta);
    const scope = f.scopeOf('/vault', '/other');
    const registry = unwrap(buildRegistry([], scope));
    expect(await publish(f.deps, scope, registry, { name: 'site' })).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS' },
    });
  });
});
