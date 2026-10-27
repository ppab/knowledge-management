import { describe, expect, it } from 'vitest';
import { unwrap } from '../../domain/result.js';
import { fixture } from '../../../test/fakes/index.js';
import { createNote } from './create-note.js';

describe('createNote', () => {
  it('creates a note from the built-in default template in the first include directory', async () => {
    const f = fixture({ include: ['docs/**/*.md'] });
    const note = unwrap(await createNote(f.deps, f.vault, { title: 'Event Ingestion' }));

    expect(note.id).toBe('ID1');
    expect(note.path).toBe('docs/event-ingestion.md');
    expect(note.title).toBe('Event Ingestion');
    const created = f.deps.clock.now().toISOString();
    expect(note.created).toBe(created);
    expect(note.dates).toEqual(['2026-10-27']); // bound to its creation day
    expect(f.fs.files.get(note.path)).toBe(
      `---\nid: "ID1"\ntitle: "Event Ingestion"\ndates: ["2026-10-27"]\ncreated: ${created}\n---\n\n# Event Ingestion\n\n`,
    );
  });

  it('renders a vault template: variables, template.path, defaults, stripped template block', async () => {
    const f = fixture();
    f.templates.set(
      'adr',
      [
        '---',
        'id: "{{id}}"',
        'title: "{{title}}"',
        'dates: ["{{date}}"]',
        'tags: [architecture] # keep',
        'status: "{{status}}"',
        'template:',
        '  path: "docs/decisions/{{date}}-{{slug}}.md"',
        '  variables:',
        '    status: { default: proposed }',
        '---',
        '# {{title}}',
        '',
        'Decided in {{vault}} by {{owner}}.',
        '',
      ].join('\n'),
    );
    const note = unwrap(
      await createNote(f.deps, f.vault, {
        title: 'Use SQLite',
        template: 'adr',
        variables: { owner: 'me' },
      }),
    );

    expect(note.path).toBe('docs/decisions/2026-10-27-use-sqlite.md');
    expect(note.dates).toEqual(['2026-10-27']);
    expect(note.tags).toEqual(['architecture']);
    const source = f.fs.files.get(note.path)!;
    // Rendering substitutes inside the YAML, so this path re-serializes: comments and order
    // survive, flow-collection spacing is normalized.
    expect(source).toContain('tags: [architecture] # keep');
    expect(source).toContain('status: "proposed"');
    expect(source).not.toContain('template:');
    expect(source).toContain('Decided in monitor by me.');
  });

  it('takes {type} from the template name for formatted identities', async () => {
    const f = fixture({
      identity: { strategy: 'formatted', format: '{vault}-{type}-{date}-{ulid}' },
    });
    f.templates.set('adr', '# {{title}}\n');
    const note = unwrap(await createNote(f.deps, f.vault, { title: 'X', template: 'adr' }));
    expect(note.id).toBe('monitor-adr-20261027-ID1');
    expect(f.fs.files.get(note.path)).toBe(
      `---\nid: monitor-adr-20261027-ID1\ntitle: X\ncreated: ${f.deps.clock.now().toISOString()}\n---\n# X\n`,
    );
  });

  it('fails before writing when a variable is missing or the path is unsafe', async () => {
    const f = fixture();
    f.templates.set('needy', '# {{title}} for {{customer}}\n');
    const missing = await createNote(f.deps, f.vault, { title: 'T', template: 'needy' });
    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { missing: ['customer'] } },
    });

    const escape = await createNote(f.deps, f.vault, { title: 'T', path: '../outside.md' });
    expect(escape).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const hidden = await createNote(f.deps, f.vault, { title: 'T', path: '.notes/x.md' });
    expect(hidden).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(f.fs.writes).toEqual([]);
  });

  it('never overwrites an existing file and never lets --var forge the id', async () => {
    const f = fixture();
    f.fs.files.set('t.md', 'existing');
    const clash = await createNote(f.deps, f.vault, { title: 'T' });
    expect(clash).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.fs.files.get('t.md')).toBe('existing');

    const forged = unwrap(
      await createNote(f.deps, f.vault, { title: 'Other', variables: { id: 'FORGED' } }),
    );
    expect(forged.id).toBe('ID2'); // ID1 was consumed by the refused attempt; never 'FORGED'
    expect(f.fs.files.get(forged.path)).toContain('id: "ID2"');
  });

  it('produces distinct ids on repeated creation', async () => {
    const f = fixture();
    const a = unwrap(await createNote(f.deps, f.vault, { title: 'A' }));
    const b = unwrap(await createNote(f.deps, f.vault, { title: 'B' }));
    expect(a.id).not.toBe(b.id);
  });
});
