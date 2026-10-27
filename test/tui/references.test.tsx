import { afterEach, describe, expect, it } from 'vitest';
import { listReferences } from '../../src/application/references/references.js';
import { unwrap } from '../../src/domain/result.js';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { harness, KEYS, type Terminal } from './harness.js';

const TARGET = '---\nid: PIPE\ntitle: Pipeline notes\n---\n\npipeline body\n';

let term: Terminal | undefined;
afterEach(() => term?.unmount());

/** Everything below the title line, so the open note's own title does not count as a row. */
const rowsOf = (frame: string): string => frame.split('\n').slice(1).join('\n');

describe('NoteView references (M6)', () => {
  it('I: picks a note from another vault, chooses a heading, inserts exactly one reference', async () => {
    const original =
      '---\nid: SRC\ntitle: Origin\n---\n\n# Intro\n\nintro text\n\n## Design\n\ndesign text\n\n## Other\n\nother text\n';
    const h = harness(
      (f) => {
        f.fs.files.set('src.md', original);
        f.fs.files.set('aside.md', '---\nid: ASIDE\ntitle: Aside\n---\n\nnothing\n');
        f.addVault('/work', 'work').fs.files.set('pipe.md', TARGET);
      },
      { scope: (f) => f.scopeOf('/vault', '/work') },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');

    await term.press('I');
    const picker = await term.waitFor('Pipeline notes');
    expect(picker).toContain('find:');
    expect(rowsOf(picker)).toContain('Aside');
    await term.press('p', 'i', 'p', 'e');
    const filtered = await term.waitFor(
      (f) => f.includes('find: pipe') && !rowsOf(f).includes('Aside'),
    );
    expect(rowsOf(filtered)).toContain('Pipeline notes');
    expect(rowsOf(filtered)).toContain('work');

    await term.press(KEYS.enter);
    const where = await term.waitFor('insert reference to Pipeline notes');
    expect(where).toContain('End of note');
    expect(where).toContain('Under # Intro');
    expect(where).toContain('Under ## Design');
    expect(where).toContain('Under ## Other');
    expect(where).toContain('References section (created when absent)');
    await term.press('j', 'j', KEYS.enter);
    await term.waitFor('Added reference to Pipeline notes');
    expect(h.f.fs.files.get('src.md')).toBe(
      original.replace('design text\n', 'design text\n\n[[PIPE]]\n'),
    );
    // The view reloaded and shows the target's title where the id was written.
    const reloaded = await term.waitFor((f) => /design text\n\s*Pipeline notes/.test(rowsOf(f)));
    expect(reloaded).not.toContain('[[PIPE]]');
  });

  it('i and a: insert next to the word under the cursor', async () => {
    const original = '---\nid: SRC\ntitle: Origin\n---\n\n# Intro\n\nintro text here\n';
    const h = harness((f) => {
      f.fs.files.set('src.md', original);
      f.fs.files.set('pipe.md', TARGET);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');

    // The cursor rests on the heading text: no reference may go there.
    await term.press('i');
    await term.waitFor('validation: Heading text cannot hold a reference');
    // Down to the paragraph, one word right, before "text".
    await term.press('j', 'j', 'w', 'i');
    await term.waitFor('find:');
    await term.press(KEYS.enter);
    await term.waitFor('Added reference to Pipeline notes');
    expect(h.f.fs.files.get('src.md')).toBe(
      original.replace('intro text here', 'intro [[PIPE]] text here'),
    );
    // After the word under the cursor: the cursor still sits on the (moved) text.
    await term.waitFor((f) => rowsOf(f).includes('intro Pipeline notes text here'));
    await term.press('$', 'a');
    await term.waitFor('find:');
    await term.press(KEYS.enter);
    await term.waitFor((f) => rowsOf(f).includes('intro Pipeline notes text here Pipeline notes'));
    expect(h.f.fs.files.get('src.md')).toBe(
      original.replace('intro text here', 'intro [[PIPE]] text here [[PIPE]]'),
    );
    // Enter on the reference under the cursor follows it; Tab moves between them.
    await term.press(KEYS.tab, KEYS.enter);
    await term.waitFor('Pipeline notes · monitor · PIPE');
  });

  it('Esc leaves the picker without changing anything', async () => {
    const h = harness((f) => {
      f.fs.files.set('src.md', '---\nid: SRC\ntitle: Origin\n---\n\nbody\n');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');
    await term.press('i');
    await term.waitFor('find:');
    await term.press(KEYS.escape);
    await term.waitFor((f) => !f.includes('find:') && f.includes('i/a/I ref  v select'));
    expect(h.f.fs.writes).toHaveLength(0);
  });

  it('v + motions + r: wraps the selected words as a labelled reference', async () => {
    const original =
      '---\nid: SRC\ntitle: Origin\n---\n\nWe built an asynchronous ingestion pipeline for events.\n';
    const h = harness((f) => {
      f.fs.files.set('src.md', original);
      f.fs.files.set('pipe.md', TARGET);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');

    await term.press('v');
    await term.waitFor('select: h/j/k/arrows move');
    // to "asynchronous", restart the selection there, then to the last letter of "pipeline"
    await term.press('w', 'w', 'w', 'v', 'w', 'w', 'w', 'h', 'h', 'r');
    await term.waitFor('find:');
    await term.press('P', 'i', 'p', 'e', KEYS.enter);
    await term.waitFor('Linked "asynchronous ingestion pipeline" to Pipeline notes');
    expect(h.f.fs.files.get('src.md')).toBe(
      original.replace(
        'asynchronous ingestion pipeline',
        '[[PIPE|asynchronous ingestion pipeline]]',
      ),
    );
    await term.waitFor((f) =>
      rowsOf(f).includes('We built an asynchronous ingestion pipeline for events.'),
    );
    // Back to browsing: j scrolls instead of extending.
    await term.press('j');
    await term.waitFor('i/a/I ref  v select');
  });

  it('refuses a selection that crosses formatting and keeps it on screen', async () => {
    const original = '---\nid: SRC\ntitle: Origin\n---\n\nPlain *emphasis* here.\n';
    const h = harness((f) => {
      f.fs.files.set('src.md', original);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');
    await term.press('v', 'w', 'r');
    await term.waitFor('validation: Selection crosses formatting');
    expect(term.frame()).not.toContain('find:');
    await term.press('l');
    await term.waitFor('validation: Selection crosses formatting');
    expect(term.frame()).not.toContain('url:');
    expect(h.f.fs.files.get('src.md')).toBe(original);
    await term.press('h'); // still selecting
    await term.waitFor('select: h/j/k/arrows move');
  });

  it('l: wraps the selection as an external link, which is not a reference', async () => {
    const original = '---\nid: SRC\ntitle: Origin\n---\n\nRead the docs now.\n';
    const h = harness((f) => {
      f.fs.files.set('src.md', original);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');
    await term.press('v', 'w', 'v', 'w', KEYS.right, KEYS.right, KEYS.right, 'l');
    await term.waitFor('url:');
    await term.type('https://x.test');
    await term.press(KEYS.enter);
    await term.waitFor('Linked "the docs" to https://x.test');
    expect(h.f.fs.files.get('src.md')).toBe(
      original.replace('the docs', '[the docs](https://x.test)'),
    );
    const listed = unwrap(await listReferences(h.f.deps, h.services.scope, 'SRC'));
    expect(listed.references).toEqual([]);
    const shown = await term.waitFor((f) =>
      rowsOf(f).includes('Read the docs (https://x.test) now.'),
    );
    expect(shown).not.toContain('[missing]');
  });

  it('clears the selection with a conflict when the file changes underneath', async () => {
    const original = '---\nid: SRC\ntitle: Origin\n---\n\nalpha beta gamma\n';
    const h = harness((f) => {
      f.fs.files.set('src.md', original);
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]);
    await term.waitFor('Origin · monitor · SRC');

    // Changed on disk and noticed by the watcher: the selection goes away at once.
    await term.press('v');
    await term.waitFor('select: h/j/k/arrows move');
    h.f.fs.files.set('src.md', original.replace('alpha', 'ALPHA'));
    h.changes.fire();
    await term.waitFor('Selection cleared: the note changed on disk');
    await term.press('j');
    await term.waitFor('i/a/I ref  v select');

    // Changed on disk but not yet noticed: the action refuses with a conflict instead.
    await term.press('v');
    await term.waitFor('select: h/j/k/arrows move');
    h.f.fs.files.set('src.md', original.replace('alpha', 'omega'));
    await term.press('w', 'r');
    await term.waitFor('conflict: src.md changed on disk since it was read');
    expect(term.frame()).not.toContain('find:');
    await term.press('j');
    await term.waitFor('i/a/I ref  v select');
    expect(h.f.fs.writes).toHaveLength(0);
  });

  it('refuses to reference from an unidentified file', async () => {
    const h = harness((f) => {
      f.fs.files.set('raw.md', 'just text\n');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ vault: 'monitor', path: 'raw.md' })]);
    await term.waitFor('· unidentified');
    await term.press('i');
    await term.waitFor('This file has no id; adopt it before adding references');
    await term.press('v');
    await term.waitFor('This file has no id; adopt it before adding references');
    expect(term.frame()).not.toContain('find:');
  });
});
