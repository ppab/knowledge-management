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
    await term.press(KEYS.ctrlO);
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

  it('leader: Space lists chords, Esc cancels, an unbound key says so, prompts keep Space', async () => {
    const h = harness((f) => {
      f.fs.files.set('a.md', '---\nid: A1\ntitle: Alpha\n---\n\nbody\n');
    });
    term = h.start();
    await term.waitFor('1 notes');

    await term.press(' ');
    const menu = await term.waitFor('Space …');
    expect(menu).toContain('c  calendar');
    expect(menu).toContain('q  quit');
    expect(menu).not.toContain('b  back'); // nothing to go back to on the start screen
    await term.press('j'); // swallowed by the pending chord: the cursor does not move
    await term.waitFor((f) => !f.includes('Space …'));
    expect(term.frame()).toContain('Space j is not bound');
    expect(term.frame()).toContain('▸ A1');

    await term.press(' ');
    await term.waitFor('Space …');
    await term.press(KEYS.escape);
    await term.waitFor((f) => !f.includes('Space …'));
    expect(term.frame()).toContain('▸ A1'); // Esc cancelled the chord, nothing else happened

    // Inside a prompt, Space is a space.
    await term.press('c', 'a', ' ', 'b', KEYS.enter);
    await term.waitFor('new note "a b" · choose a template');
    await term.press(KEYS.escape);
    await term.waitFor('1 notes');
  });

  it('creates a note from the title prompt, confirming the only template, and opens it', async () => {
    const h = harness(() => undefined);
    term = h.start();
    await term.waitFor('0 notes');
    await term.press('c', 'N', 'e', 'w', KEYS.enter);
    const choice = await term.waitFor('new note "New" · choose a template');
    expect(choice).toContain('default');
    expect(choice).toContain('new.md');
    await term.press(KEYS.enter);
    await term.waitFor('New · monitor · ID1');
    expect(h.f.fs.writes.map((w) => w.path)).toEqual(['new.md']);
  });

  it('offers the vault templates after the title, default first', async () => {
    const h = harness((f) => {
      f.templates.set(
        'adr',
        '---\nid: "{{id}}"\ntitle: "{{title}}"\ntemplate:\n  path: "decisions/{{slug}}.md"\n---\n# {{title}}\n',
      );
    });
    term = h.start();
    await term.waitFor('0 notes');
    await term.press('c');
    await term.type('Use git');
    await term.press(KEYS.enter);
    const choice = await term.waitFor('new note "Use git" · choose a template');
    expect(choice.indexOf('default')).toBeLessThan(choice.indexOf('adr'));
    expect(choice).toContain('use-git.md'); // where `default` would write
    expect(choice).toContain('decisions/use-git.md'); // where `adr` would
    expect(choice).toContain('Enter create  Esc cancel');

    await term.press(KEYS.escape);
    await term.waitFor('0 notes');
    expect(h.f.fs.writes).toEqual([]);

    await term.press('c');
    await term.type('Use git');
    await term.press(KEYS.enter);
    await term.waitFor('choose a template');
    await term.press('j', KEYS.enter);
    await term.waitFor('Use git · monitor · ID1');
    expect(h.f.fs.writes.map((w) => w.path)).toEqual(['decisions/use-git.md']);
  });
});
