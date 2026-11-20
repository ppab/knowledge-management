import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import type { Publication } from '../../domain/publishing/publication.js';
import { parseAstroTheme } from '../../infrastructure/config/astro-theme-file.js';
import { fixture, type Fixture } from '../../../test/fakes/index.js';
import { diagnose } from '../doctor/diagnose.js';
import { buildRegistry } from '../plugin/registry.js';
import type { EntryPlugin } from '../plugin/plugin.js';
import { publish } from './publish.js';

/*
 * A theme the vault declares (`.ofl/astro-themes/site/theme.yaml`) driving the astro
 * destination end to end: the locale-aware path, the frontmatter mapping, and the requirements
 * that refuse a publication.
 */

const site = unwrap(
  parseAstroTheme(
    'site',
    parse(`
version: 0.1.0
collections:
  notebook:
    route: /notebook/{{slug}}/
    path: notebook/en/{{slug}}.md
    fields:
      - { name: slug, required: true }
      - { name: kind, required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }
      - { name: summary }
      - { name: hideFromIndex, type: boolean }
    frontmatter:
      title: title
      kind: kind
      summary: [summary, description]
      date: { from: created, as: date }
      hideFromIndex: hideFromIndex
  work:
    route: /work/{{slug}}/
    path: work/en/{{slug}}.md
    images: forbid
    frontmatter:
      title: title
`),
  ),
);

const publication = (collection: string, include: string): Publication => ({
  name: collection,
  destination: { kind: 'astro', options: { theme: 'site', collection } },
  output: '/out/site',
  route: '/{{slug}}/',
  include: [include],
  exclude: [],
  references: 'strip-to-label',
});

const setup = (files: Record<string, string>): Fixture => {
  const f = fixture({
    astroThemes: { site },
    publications: {
      notebook: publication('notebook', 'notebook/**'),
      work: publication('work', 'work/**'),
    },
  });
  for (const [path, content] of Object.entries(files)) f.fs.files.set(path, content);
  return f;
};

const run = (f: Fixture, name: string, dryRun = false) =>
  publish(f.deps, f.scope, unwrap(buildRegistry([], f.scope)), { name, dryRun });

const note = (id: string, extra: string, body = 'Body.\n'): string =>
  `---\nid: ${id}\nvisibility: public\ntitle: Note ${id}\n${extra}---\n${body}`;

describe('publish — astro with a vault-declared theme', () => {
  it('offers the declared theme next to the built-in one', () => {
    const f = setup({});
    const astro = unwrap(buildRegistry([], f.scope))
      .destinationsFor('/vault')
      .find((d) => d.kind === 'astro');
    expect(astro?.options().find((o) => o.name === 'theme')?.values).toEqual(['modular', 'site']);
    expect(astro?.options({ theme: 'site' }).find((o) => o.name === 'collection')?.values).toEqual([
      'notebook',
      'work',
    ]);
  });

  it('writes to the collection path with the declared frontmatter, and links by route', async () => {
    const f = setup({
      'notebook/a.md': note(
        'A',
        'slug: on-attention\nkind: essay\ndescription: Notes on focus.\ncreated: 2026-11-12T09:30:00.000Z\nhideFromIndex: true\nextra: dropped\n',
        'See [[B]].\n',
      ),
      'notebook/b.md':
        '---\nid: B\nvisibility: public\ntitle: Routing\nslug: routing\nkind: lesson\n---\nB.\n',
    });
    unwrap(await run(f, 'notebook'));
    const file = f.outputs.files.get('/out/site/src/content/notebook/en/on-attention.md');
    expect(file).toBeDefined();
    expect(file).toContain('title: Note A');
    expect(file).toContain('kind: essay');
    expect(file).toContain('summary: Notes on focus.'); // fell back to `description`
    expect(file).toContain('date: 2026-11-12'); // instant trimmed to a date
    expect(file).toContain('hideFromIndex: true');
    // Only what the theme maps is written: no core bookkeeping, no undeclared keys.
    expect(file).not.toContain('visibility:');
    expect(file).not.toContain('slug:');
    expect(file).not.toContain('extra:');
    expect(file).not.toContain('id:');
    expect(file).toContain('See [Routing](/notebook/routing/).');
    // A key with no value in any source is left out rather than written empty.
    const other = f.outputs.files.get('/out/site/src/content/notebook/en/routing.md');
    expect(other).not.toContain('summary:');
    expect(other).not.toContain('date:');
  });

  it('refuses a note missing a required field or an explicit slug, and writes nothing', async () => {
    const f = setup({
      'notebook/a.md': note('A', 'slug: on-attention\nkind: essay\n'),
      'notebook/b.md': note('B', 'kind: essay\n'), // slug would only be derived from the title
      'notebook/c.md': note('C', 'slug: c\n'), // no kind
    });
    const result = await run(f, 'notebook');
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: expect.stringContaining('"kind" is required') as string,
      },
    });
    expect(f.outputs.writes).toEqual([]);

    const dry = unwrap(await run(f, 'notebook', true));
    expect(dry.kind === 'planned' ? dry.problems : []).toEqual([
      // In plan order, which is by route: /notebook/c/ before /notebook/note-b/.
      {
        id: 'C',
        path: 'notebook/c.md',
        field: 'kind',
        message: expect.stringContaining('"kind" is required') as string,
      },
      {
        id: 'B',
        path: 'notebook/b.md',
        field: 'slug',
        message: expect.stringContaining('"slug" is required') as string,
      },
    ]);
  });

  it('refuses a value of the wrong type or one that does not match its pattern', async () => {
    const f = setup({
      'notebook/a.md': note('A', 'slug: a\nkind: Big Essay\nhideFromIndex: maybe\n'),
    });
    const dry = unwrap(await run(f, 'notebook', true));
    expect((dry.kind === 'planned' ? dry.problems : []).map((p) => p.field)).toEqual([
      'hideFromIndex',
      'kind',
    ]);
  });

  it('refuses an image in a collection that forbids them, but not one shown as code', async () => {
    const withImage = setup({
      'work/a.md': note('A', 'slug: a\n', 'Look: ![cover](/cover.png)\n'),
    });
    expect(await run(withImage, 'work')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('work/a.md') as string },
    });
    expect(withImage.outputs.writes).toEqual([]);

    const rawTag = setup({ 'work/a.md': note('A', 'slug: a\n', '<img src="/cover.png">\n') });
    expect(await run(rawTag, 'work')).toMatchObject({ ok: false });

    const asCode = setup({
      'work/a.md': note(
        'A',
        'slug: a\n',
        'Write `<img src="x">` or:\n\n```md\n![alt](x.png)\n```\n',
      ),
    });
    unwrap(await run(asCode, 'work'));
    expect(asCode.outputs.files.has('/out/site/src/content/work/en/a.md')).toBe(true);
  });

  it('reports through doctor what publish would refuse', async () => {
    const f = setup({
      'notebook/ok.md': note('OK', 'slug: ok\nkind: essay\nfoo: bar\n'),
      'notebook/bad.md': note('BAD', 'kind: essay\n'),
    });
    const diagnosis = unwrap(await diagnose(f.deps, f.scope, unwrap(buildRegistry([], f.scope))));
    const findings = diagnosis.findings.filter((x) => x.kind === 'publication');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      message: expect.stringContaining('notebook/bad.md') as string,
      details: { publication: 'notebook', field: 'slug' },
    });
  });
});

describe('vault-declared theme names', () => {
  const named = (name: string) => ({ ...site, name });

  it('rejects a declared theme that shadows the built-in', () => {
    const f = fixture({ astroThemes: { modular: named('modular') } });
    expect(buildRegistry([], f.scope)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('built-in') as string },
    });
  });

  it('rejects a declared theme that shadows a theme of a plugin the vault enables', () => {
    const plugin: EntryPlugin = {
      name: 'pub',
      description: 'pub',
      types: ['pub'],
      fields: [],
      astroThemes: [{ name: 'site', contentDir: 'src/content', collections: {} }],
    };
    const f = fixture({ plugins: { pub: {} }, astroThemes: { site } });
    expect(buildRegistry([plugin], f.scope)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('"pub"') as string },
    });
  });

  it('lets two vaults each declare a theme of the same name', () => {
    const f = fixture({ astroThemes: { site } });
    f.addVault('/other', 'other', { astroThemes: { site: named('site') } });
    expect(buildRegistry([], f.scopeOf('/vault', '/other')).ok).toBe(true);
  });
});
