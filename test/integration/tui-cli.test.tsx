import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadScope } from '../../src/application/vault/vault.js';
import { unwrap } from '../../src/domain/result.js';
import { createDeps } from '../../src/infrastructure/deps.js';
import { App } from '../../src/interfaces/tui/App.js';
import type { TuiServices } from '../../src/interfaces/tui/context.js';
import { noteScreen } from '../../src/interfaces/tui/model.js';
import { createTheme } from '../../src/interfaces/tui/theme.js';
import { buildTuiRegistry } from '../../src/interfaces/tui/tui.js';
import { firstPartyPlugins } from '../../src/plugins/index.js';
import { fakeChanges, fakeEditor, KEYS, renderTerminal } from '../tui/harness.js';

/** M5 through the real CLI: `notes` without a terminal, and `notes edit` with a fake editor. */
const run = promisify(execFile);
const tsx = resolve(import.meta.dirname, '../../node_modules/.bin/tsx');
const main = resolve(import.meta.dirname, '../../src/interfaces/cli/main.ts');

let root: string;

const notes = async (args: string[], env: Record<string, string> = {}) => {
  try {
    const { stdout, stderr } = await run(tsx, [main, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'notes-tui-cli-'));
  expect((await notes(['init', '--name', 'demo'])).code).toBe(0);
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('notes (no subcommand) and notes edit', () => {
  it('refuses to start the TUI without a terminal, with a usage error', async () => {
    const result = await notes([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('interactive terminal');
    const asJson = await notes(['--json']);
    expect(JSON.parse(asJson.stdout)).toMatchObject({ error: { code: 'USAGE' } });
  });

  it('opens the note file in $EDITOR and the next read sees the edit', async () => {
    const created = await notes(['create', '--title', 'Draft', '--json']);
    const { id, path } = JSON.parse(created.stdout) as { id: string; path: string };
    const fake = join(root, 'fake-editor.sh');
    await writeFile(fake, '#!/bin/sh\nprintf "\\nappended by editor\\n" >> "$1"\n', {
      mode: 0o755,
    });

    const edited = await notes(['edit', 'Draft'], { EDITOR: fake, VISUAL: '' });
    expect(edited.code).toBe(0);
    expect(edited.stdout).toBe(`Edited ${path}\n`);
    expect(await readFile(join(root, path), 'utf8')).toContain('appended by editor');
    expect((await notes(['show', id])).stdout).toContain('appended by editor');

    const missing = await notes(['edit', 'Nope'], { EDITOR: fake });
    expect(missing.code).toBe(3);
    const noEditor = await notes(['edit', 'Draft'], { EDITOR: 'no-such-editor-xyz', VISUAL: '' });
    expect(noEditor.code).toBe(7);
  });
});

describe('reference add --label and the TUI selection path agree', () => {
  it('produces byte-identical files', async () => {
    // Two vaults with the same target; A gets the reference through the CLI, B through the TUI.
    const roots = await Promise.all(
      ['a', 'b'].map(async (name) => {
        const dir = await mkdtemp(join(tmpdir(), `notes-parity-${name}-`));
        const init = await run(tsx, [main, 'init', '--name', name], { cwd: dir });
        expect(init.stderr).toBe('');
        await writeFile(join(dir, 'target.md'), '---\nid: TGT\ntitle: Target\n---\n\ntarget\n');
        return dir;
      }),
    );
    const [a, b] = roots as [string, string];
    try {
      // The CLI inserts "[[TGT|ingestion pipeline]]" at the end of a note that ends with "intro".
      await writeFile(join(a, 'src.md'), '---\nid: SRC\ntitle: Source\n---\n\nintro\n');
      const added = await run(
        tsx,
        [
          main,
          'reference',
          'add',
          '--source',
          'SRC',
          '--target',
          'TGT',
          '--label',
          'ingestion pipeline',
        ],
        { cwd: a },
      );
      expect(added.stderr).toBe('');

      // The TUI wraps the words "ingestion pipeline" that already end the same note.
      await writeFile(
        join(b, 'src.md'),
        '---\nid: SRC\ntitle: Source\n---\n\nintro\n\ningestion pipeline\n',
      );
      const deps = createDeps();
      const scope = unwrap(await loadScope(deps, { vaults: [b], cwd: b }));
      const registry = unwrap(buildTuiRegistry(deps, scope, firstPartyPlugins));
      const services: TuiServices = {
        deps,
        scope,
        registry,
        editor: fakeEditor(),
        cwd: b,
        theme: createTheme({}),
      };
      const term = renderTerminal(
        <App
          services={services}
          changes={fakeChanges()}
          initial={[{ kind: 'list', cursor: 0 }, noteScreen({ query: 'SRC' })]}
        />,
      );
      try {
        await term.waitFor('Source · b · SRC');
        // v starts on "intro"; w moves to "ingestion", v restarts there, $ reaches the end.
        await term.press('v', 'w', 'v', '$', 'r');
        await term.waitFor('find:');
        await term.type('Target');
        await term.press(KEYS.enter);
        await term.waitFor('Linked "ingestion pipeline" to Target');
      } finally {
        term.unmount();
      }

      const viaCli = await readFile(join(a, 'src.md'), 'utf8');
      const viaTui = await readFile(join(b, 'src.md'), 'utf8');
      expect(viaCli).toContain('[[TGT|ingestion pipeline]]');
      expect(viaTui).toBe(viaCli);
    } finally {
      await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    }
  });
});
