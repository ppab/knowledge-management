import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * The layer rules in eslint.config.js are the only thing that keeps the domain free of
 * infrastructure. This test proves the rules fire, so a config regression cannot go unnoticed.
 *
 * The files linted here are virtual, which the type-aware project service rejects; the boundary
 * rule is purely syntactic, so type checking is switched off for this instance.
 */
const eslint = new ESLint({
  cwd: import.meta.dirname + '/..',
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

const violations = async (filePath: string, source: string) => {
  const [result] = await eslint.lintText(source, { filePath });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
};

describe('layer boundaries', () => {
  it.each([
    ['src/domain/x.ts', "import 'node:fs';", 'relative modules'],
    ['src/domain/x.ts', "import 'zod';", 'relative modules'],
    ['src/domain/x.ts', "import '../application/ports.js';", '"application"'],
    ['src/domain/x.ts', "import '../infrastructure/sqlite/index.js';", '"infrastructure"'],
    ['src/application/x.ts', "import '../infrastructure/sqlite/index.js';", '"infrastructure"'],
    ['src/application/x.ts', "import '../interfaces/cli/main.js';", '"interfaces"'],
    ['src/application/x.ts', "import 'commander';", 'relative modules'],
    ['src/infrastructure/x.ts', "import '../interfaces/cli/main.js';", '"interfaces"'],
    ['src/interfaces/cli/x.ts', "import '../tui/app.js';", '"tui"'],
    ['src/interfaces/tui/x.ts', "import '../cli/main.js';", '"cli"'],
    ['src/domain/x.ts', "import '../plugins/index.js';", '"plugins"'],
    ['src/application/x.ts', "import '../plugins/index.js';", '"plugins"'],
    ['src/infrastructure/x.ts', "import '../plugins/index.js';", '"plugins"'],
    ['src/plugins/todos/x.ts', "import 'commander';", 'relative modules'],
    ['src/plugins/todos/x.ts', "import 'ink';", 'relative modules'],
    ['src/plugins/todos/x.ts', "import 'node:fs';", 'relative modules'],
    ['src/plugins/todos/x.ts', "import '../../infrastructure/deps.js';", '"infrastructure"'],
    ['src/plugins/todos/x.ts', "import '../../interfaces/cli/main.js';", '"interfaces"'],
  ])('%s rejects %s', async (file, source, expected) => {
    const messages = await violations(file, source);
    expect(messages.join('\n')).toContain(expected);
  });

  it.each([
    ['src/domain/x.ts', "import './result.js';"],
    ['src/application/x.ts', "import '../domain/result.js';"],
    ['src/application/x.ts', "import './plugin/plugin.js';"],
    ['src/infrastructure/x.ts', "import 'node:fs'; import '../application/ports.js';"],
    ['src/interfaces/cli/x.ts', "import '../../infrastructure/sqlite/index.js';"],
    ['src/interfaces/cli/x.ts', "import '../../plugins/index.js';"],
    ['src/plugins/todos/x.ts', "import '../../application/plugin/plugin.js';"],
    ['src/plugins/todos/x.ts', "import '../../domain/result.js'; import './queries.js';"],
  ])('%s allows %s', async (file, source) => {
    expect(await violations(file, source)).toEqual([]);
  });
});
