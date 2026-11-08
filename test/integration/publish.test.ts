import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Runs the real CLI (through tsx) in a temporary vault. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

const notes = async (cwd: string, ...args: string[]): Promise<Outcome> => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

const sha = async (path: string): Promise<string> =>
  createHash('sha256').update(await readFile(path)).digest('hex');

const missing = async (path: string): Promise<boolean> =>
  stat(path).then(() => false).catch(() => true);

const alpha = '---\nid: AAA\nvisibility: public\ntitle: Alpha\n---\n\nSee [[BBB]], [[SEC]] and [[GONE]].\n';
const beta = '---\nid: BBB\nvisibility: public\ntitle: Beta\n---\n\nBeta body.\n';
const secret = '---\nid: SEC\nvisibility: private\ntitle: Secret\n---\n\nhidden\n';

const config = (base: string, policy: string): string =>
  `${base}\npublications:\n` +
  `  site:\n    destination: { kind: html, layout: directory }\n    output: ./site\n    include: [notes/**]\n    references: ${policy}\n` +
  `  content:\n    destination: markdown\n    output: ./content\n    include: [notes/**]\n    references: ${policy}\n`;

describe('notes publish', () => {
  let root: string;
  let configPath: string;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'notes-publish-'));
    await notes(root, 'init', '--name', 'demo', '--dir', 'notes');
    configPath = join(root, '.notes', 'config.yaml');
    base = await readFile(configPath, 'utf8');
    await writeFile(join(root, 'notes', 'alpha.md'), alpha);
    await writeFile(join(root, 'notes', 'beta.md'), beta);
    await writeFile(join(root, 'notes', 'secret.md'), secret);
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('lists, refuses on a fail-policy violation, then strips and writes, leaving sources intact', async () => {
    await writeFile(configPath, config(base, 'fail'));

    const list = await notes(root, 'publish');
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('site');
    expect(list.stdout).toContain('content');

    const dry = await notes(root, 'publish', 'site', '--dry-run');
    expect(dry.code).toBe(6); // violations under the fail policy
    expect(dry.stdout).toContain('private'); // the private note is listed as excluded
    expect(await missing(join(root, 'site'))).toBe(true); // a dry run writes nothing

    const before = {
      alpha: await sha(join(root, 'notes', 'alpha.md')),
      secret: await sha(join(root, 'notes', 'secret.md')),
    };

    await writeFile(configPath, config(base, 'strip-to-label'));
    const site = await notes(root, 'publish', 'site');
    expect(site.code).toBe(0);
    const html = await readFile(join(root, 'site', 'alpha', 'index.html'), 'utf8');
    expect(html).toContain('<a href="/beta/">Beta</a>'); // published reference → route link
    expect(html).toContain('Secret'); // excluded private target → its label, no link
    expect(html).not.toContain('[[');
    const manifest = JSON.parse(await readFile(join(root, 'site', 'manifest.json'), 'utf8')) as {
      entries: { id: string }[];
    };
    expect(manifest.entries.map((e) => e.id).sort()).toEqual(['AAA', 'BBB']);

    const content = await notes(root, 'publish', 'content');
    expect(content.code).toBe(0);
    const md = await readFile(join(root, 'content', 'alpha.md'), 'utf8');
    expect(md).toContain('[Beta](./beta.md)');
    expect(md).toContain('title: Alpha'); // frontmatter kept verbatim

    // Sources are byte-for-byte unchanged by publishing.
    expect(await sha(join(root, 'notes', 'alpha.md'))).toBe(before.alpha);
    expect(await sha(join(root, 'notes', 'secret.md'))).toBe(before.secret);
  });

  it('publishes an Astro content collection with mapped frontmatter', async () => {
    const v = await mkdtemp(join(tmpdir(), 'notes-publish-astro-'));
    try {
      await notes(v, 'init', '--name', 'blog', '--dir', 'notes');
      const cfg = join(v, '.notes', 'config.yaml');
      const base = await readFile(cfg, 'utf8');
      await writeFile(
        cfg,
        `${base}\npublications:\n  blog:\n    destination: { kind: astro, theme: modular }\n    output: ./site\n    include: [notes/**]\n    references: strip-to-label\n`,
      );
      await writeFile(
        join(v, 'notes', 'post.md'),
        '---\nid: PST\nvisibility: public\ntitle: First Post\ncreated: 2026-01-02T09:00:00.000Z\ndescription: A first post\ntags: [intro]\n---\n\nHello.\n',
      );
      const out = await notes(v, 'publish', 'blog');
      expect(out.code).toBe(0);
      const post = await readFile(join(v, 'site', 'src', 'content', 'posts', 'first-post.md'), 'utf8');
      expect(post).toContain('title: First Post');
      expect(post).toContain('date: 2026-01-02');
      expect(post).toContain('description: A first post');
      expect(post).not.toContain('visibility:');
      expect(await missing(join(v, 'site', '.capture', 'manifest.json'))).toBe(false);
    } finally {
      await rm(v, { recursive: true, force: true });
    }
  });

  it('aborts on a route collision and errors on an unknown publication', async () => {
    const v = await mkdtemp(join(tmpdir(), 'notes-publish-x-'));
    try {
      await notes(v, 'init', '--name', 'x', '--dir', 'notes');
      const cfg = join(v, '.notes', 'config.yaml');
      await writeFile(cfg, config(await readFile(cfg, 'utf8'), 'strip-to-label'));
      await writeFile(join(v, 'notes', 'one.md'), '---\nid: ONE\nvisibility: public\ntitle: T\nslug: same\n---\n');
      await writeFile(join(v, 'notes', 'two.md'), '---\nid: TWO\nvisibility: public\ntitle: U\nslug: same\n---\n');

      const collide = await notes(v, 'publish', 'content');
      expect(collide.code).toBe(6);
      expect(await missing(join(v, 'content'))).toBe(true);

      expect((await notes(v, 'publish', 'ghost')).code).toBe(3);
    } finally {
      await rm(v, { recursive: true, force: true });
    }
  });
});
