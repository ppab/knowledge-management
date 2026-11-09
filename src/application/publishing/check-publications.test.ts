import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import type { Publication } from '../../domain/publishing/publication.js';
import { fixture } from '../../../test/fakes/index.js';
import { diagnose } from '../doctor/diagnose.js';
import { buildRegistry } from '../plugin/registry.js';

const astroBlog: Publication = {
  name: 'blog',
  destination: { kind: 'astro', options: { theme: 'modular' } },
  output: '/out/blog',
  route: '/posts/{{slug}}/',
  include: ['posts/**'],
  exclude: [],
  references: 'strip-to-label',
};

describe('publicationFindings via doctor', () => {
  it('warns on a selected post missing a required destination field, and ignores undeclared ones', async () => {
    const f = fixture({ publications: { blog: astroBlog } });
    f.fs.files.set(
      'posts/ok.md',
      '---\nid: OK\nvisibility: public\ntitle: Ok\ndescription: fine\nfoo: bar\n---\n',
    );
    f.fs.files.set('posts/bad.md', '---\nid: BAD\nvisibility: public\ntitle: Bad\n---\n');
    const registry = unwrap(buildRegistry([], f.scope));
    const diagnosis = unwrap(await diagnose(f.deps, f.scope, registry));
    const publicationFindings = diagnosis.findings.filter((x) => x.kind === 'publication');
    expect(publicationFindings).toHaveLength(1);
    expect(publicationFindings[0]).toMatchObject({
      severity: 'warning',
      message: expect.stringContaining('posts/bad.md') as string,
      details: { publication: 'blog', field: 'description', problem: 'missing' },
    });
  });

  it('does not select or warn about a private note', async () => {
    const f = fixture({ publications: { blog: astroBlog } });
    f.fs.files.set('posts/secret.md', '---\nid: S\nvisibility: private\ntitle: Secret\n---\n');
    const registry = unwrap(buildRegistry([], f.scope));
    const diagnosis = unwrap(await diagnose(f.deps, f.scope, registry));
    expect(diagnosis.findings.filter((x) => x.kind === 'publication')).toEqual([]);
  });
});
