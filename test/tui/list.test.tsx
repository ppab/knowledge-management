import { afterEach, describe, expect, it } from 'vitest';
import { harness, KEYS, type Terminal } from './harness.js';

const notes = {
  'a.md': '---\nid: A1\ntitle: Alpha\ntags: [one]\n---\n\n# Alpha\n\nalpha body about pipelines\n',
  'b.md': '---\nid: B1\ntitle: Beta\ntags: [two]\n---\n\n# Beta\n\nbeta body\n',
  'c.md': '# Gamma\n\nno frontmatter here\n',
};

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('NoteList', () => {
  it('browses, opens with Enter, filters by search and tag, and quits with q', async () => {
    const h = harness((f) => {
      for (const [path, source] of Object.entries(notes)) f.fs.files.set(path, source);
    });
    term = h.start();
    const frame = await term.waitFor('3 notes');
    expect(frame).toContain('A1  Alpha');
    expect(frame).toContain('-   Gamma'); // unidentified files are listed too
    expect(frame).toContain('j/k move');

    await term.press('j', KEYS.enter);
    await term.waitFor('Beta · monitor · B1');
    expect(term.frame()).toContain('beta body');
    await term.press('u');
    await term.waitFor('3 notes');

    // Unidentified entries open by path.
    await term.press('G', KEYS.enter);
    await term.waitFor('Gamma · monitor · unidentified');
    await term.press(KEYS.escape);

    await term.press('/', 'p', 'i', 'p', 'e', '*', KEYS.enter);
    const searched = await term.waitFor('search: pipe*');
    expect(searched).toContain('1 notes');
    expect(searched).toContain('Alpha');
    expect(searched).not.toContain('Beta');
    await term.press(KEYS.escape);
    await term.waitFor('3 notes');

    await term.press('t', 't', 'w', 'o', KEYS.enter);
    const tagged = await term.waitFor('tag: two');
    expect(tagged).toContain('Beta');
    expect(tagged).not.toContain('Alpha');

    const exited = term.waitUntilExit();
    await term.press(KEYS.escape, 'q');
    await exited;
  });

  it('creates a note from the title prompt and opens it', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');
    await term.press('n', 'N', 'e', 'w', KEYS.enter);
    await term.waitFor('New · monitor · ID1');
    expect(h.f.fs.writes.map((w) => w.path)).toEqual(['new.md']);
  });
});
