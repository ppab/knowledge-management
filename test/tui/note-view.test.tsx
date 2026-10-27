import { afterEach, describe, expect, it } from 'vitest';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { harness, KEYS, type Terminal } from './harness.js';

const longBody = Array.from({ length: 40 }, (_, i) => `line ${String(i + 1)}`).join('\n\n');

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('NoteView', () => {
  it('scrolls, follows a reference, and comes back to the same scroll position', async () => {
    const h = harness((f) => {
      f.fs.files.set(
        'src.md',
        `---\nid: SRC\ntitle: Source\n---\n\n${longBody}\n\nSee [[DST|the target]] here.\n`,
      );
      f.fs.files.set('dst.md', '---\nid: DST\ntitle: Destination\n---\n\ndestination body\n');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })], { rows: 12 });
    await term.waitFor('Source · monitor · SRC');
    expect(term.frame()).toContain('line 1');
    expect(term.frame()).not.toContain('line 9');

    await term.press('j', 'j', 'j', 'j', 'j');
    await term.waitFor((f) => f.includes('line 4') && !f.includes('line 1\n'));
    // Tab jumps to the reference, scrolling it into view; Enter follows it.
    await term.press(KEYS.tab);
    const atRef = await term.waitFor('the target');
    expect(atRef).not.toContain('line 4\n');
    await term.press(KEYS.enter);
    await term.waitFor('Destination · monitor · DST');
    expect(term.frame()).toContain('destination body');

    await term.press('u');
    const back = await term.waitFor('Source · monitor · SRC');
    expect(back).toBe(atRef); // same scroll, same reference cursor
    await term.press(KEYS.backspace);
    await term.waitFor('notes · monitor');
  });

  it('marks unresolved and ambiguous references and explains instead of navigating', async () => {
    const h = harness((f) => {
      f.fs.files.set('n.md', '---\nid: N\ntitle: Note\n---\n\nmissing [[NOPE]] · dup [[DUP]]\n');
      f.fs.files.set('d1.md', '---\nid: DUP\ntitle: Dup one\n---\n');
      f.fs.files.set('d2.md', '---\nid: DUP\ntitle: Dup two\n---\n');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N' })]);
    const frame = await term.waitFor('Note · monitor · N');
    expect(frame).toContain('NOPE [missing]');
    expect(frame).toContain('DUP [ambiguous]');

    await term.press(KEYS.tab, KEYS.enter);
    await term.waitFor('Reference [[NOPE]] is unresolved: no note has that id');
    await term.press(KEYS.tab, KEYS.enter);
    await term.waitFor('Reference [[DUP]] is ambiguous: monitor:d1.md, monitor:d2.md');
    expect(term.frame()).toContain('Note · monitor · N'); // still on the same screen
  });

  it('marks a reference as unavailable when a vault of the scope could not be opened', async () => {
    const h = harness(
      (f) => {
        f.fs.files.set('n.md', '---\nid: N\ntitle: Note\n---\n\nsee [[GONE]]\n');
      },
      { scope: (f) => f.scopeOf('/vault', { root: '/offline', reason: 'disk not mounted' }) },
    );
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'N' })]);
    const frame = await term.waitFor('Note · monitor · N');
    expect(frame).toContain('GONE [unavailable]');
    await term.press(KEYS.tab, KEYS.enter);
    await term.waitFor('cannot be resolved: vault(s) unavailable: /offline');
  });

  it('toggles the metadata and backlinks panels', async () => {
    const h = harness((f) => {
      f.fs.files.set(
        't.md',
        '---\nid: T\ntitle: Target\ntags: [x, y]\ndates: [2026-10-27]\n---\n\nbody\n',
      );
      f.fs.files.set('l.md', '---\nid: L\ntitle: Linker\n---\n\nlinks to [[T|the target]]\n');
    });
    term = h.start([{ kind: 'list', cursor: 0 }, noteScreen({ query: 'T' })], { columns: 100 });
    await term.waitFor('Target · monitor · T');
    expect(term.frame()).toContain('m metadata  b backlinks');

    await term.press('m');
    const meta = await term.waitFor('Metadata');
    expect(meta).toContain('tags: x, y');
    expect(meta).toContain('dates: 2026-10-27');
    expect(meta).toContain('panel: j/k move');

    await term.press('b');
    const links = await term.waitFor('Backlinks');
    expect(links).not.toContain('Metadata');
    expect(links).toContain('Linker');
    expect(links).toContain('"the target"');

    // Enter on the backlink opens the linking note; back restores the panel.
    await term.press(KEYS.enter);
    await term.waitFor('Linker · monitor · L');
    await term.press('u');
    await term.waitFor('Backlinks');
    await term.press(KEYS.escape);
    await term.waitFor((f) => !f.includes('Backlinks'));
    expect(term.frame()).toContain('Target · monitor · T');
  });
});
