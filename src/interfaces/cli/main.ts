import { Command } from 'commander';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../../../package.json') as { version: string };

export const buildProgram = (): Command =>
  new Command('notes')
    .description('Local-first, Git-native knowledge management')
    .version(version)
    .showHelpAfterError();

const program = buildProgram();
program.parse();
