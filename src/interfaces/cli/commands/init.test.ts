import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../test/fakes/index.js';
import { buildProgram } from '../program.js';
import type { CliIo } from '../context.js';

/** Drives the commander program in-process with fake adapters and a scripted terminal. */
const cli = (answers: string[] | null) => {
  const f = fixture();
  const out: string[] = [];
  const asked: string[] = [];
  const io: CliIo = {
    deps: f.deps,
    editor: { open: () => Promise.reject(new Error('no editor in this test')) },
    cwd: '/fresh',
    out: (text) => out.push(text),
    errOut: (text) => out.push(`! ${text}`),
    ...(answers && {
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answers.shift() ?? '');
      },
    }),
  };
  let code = -1;
  const program = buildProgram(io, (c) => {
    code = c;
  });
  return {
    f,
    out,
    asked,
    run: async (...args: string[]) => {
      await program.parseAsync(args, { from: 'user' });
      return code;
    },
  };
};

describe('notes init', () => {
  it('asks for the notes directory when interactive and no --dir was given', async () => {
    const t = cli(['notes']);
    expect(await t.run('init', '--name', 'demo')).toBe(0);
    expect(t.asked).toEqual(['Directory for notes, relative to the vault root [.]: ']);
    expect(t.f.vaults.get('/fresh')?.include).toEqual(['notes/**/*.md']);
    expect(t.out.join('\n')).toContain('New notes go to notes/ (include: notes/**/*.md)');
  });

  it('keeps the whole vault on an empty answer and says so', async () => {
    const t = cli(['']);
    expect(await t.run('init')).toBe(0);
    expect(t.f.vaults.get('/fresh')?.include).toEqual(['**/*.md']);
    expect(t.out.join('\n')).toContain('New notes go to the vault root (include: **/*.md)');
  });

  it('never asks with --dir, with --json, or without a terminal', async () => {
    const flagged = cli(['ignored']);
    expect(await flagged.run('init', '--dir', 'docs/')).toBe(0);
    expect(flagged.asked).toEqual([]);
    expect(flagged.f.vaults.get('/fresh')?.include).toEqual(['docs/**/*.md']);

    const json = cli(['ignored']);
    expect(await json.run('init', '--json')).toBe(0);
    expect(json.asked).toEqual([]);
    expect(JSON.parse(json.out[0] ?? '')).toMatchObject({ include: ['**/*.md'] });

    const piped = cli(null);
    expect(await piped.run('init')).toBe(0);
    expect(piped.f.vaults.get('/fresh')?.include).toEqual(['**/*.md']);
  });

  it('rejects a directory outside the vault with exit 6', async () => {
    const t = cli(null);
    expect(await t.run('init', '--dir', '../up')).toBe(6);
    expect(t.f.vaults.has('/fresh')).toBe(false);
  });
});
