// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Layer boundaries (see docs/architecture.md §1 and docs/plugins.md §6). Dependencies point
 * inward only:
 *
 *   interfaces → plugins, application → domain
 *   infrastructure → application, domain
 *   plugins → application, domain
 *
 * `domain`, `application` and `plugins` may only import relative modules: no packages, no
 * `node:` builtins. Anything they need from the outside world arrives through a port (or, for
 * plugins, through the plugin API). Nothing below `interfaces` may import `plugins`.
 */
const onlyRelativeImports = {
  regex: String.raw`^(?!\.)`,
  message: 'This layer may only import its own relative modules; use a port instead.',
};

const forbidLayers = (...layers) =>
  layers.map((layer) => ({
    regex: String.raw`(^|/)${layer}(/|$)`,
    message: `This layer must not depend on "${layer}".`,
  }));

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            onlyRelativeImports,
            ...forbidLayers('application', 'infrastructure', 'interfaces', 'plugins'),
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            onlyRelativeImports,
            ...forbidLayers('infrastructure', 'interfaces', 'plugins'),
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbidLayers('interfaces', 'plugins') }],
    },
  },
  {
    files: ['src/plugins/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [onlyRelativeImports, ...forbidLayers('infrastructure', 'interfaces')] },
      ],
    },
  },
  {
    files: ['src/interfaces/cli/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbidLayers('tui') }],
    },
  },
  {
    files: ['src/interfaces/tui/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbidLayers('cli') }],
    },
  },
  {
    files: ['**/*.test.ts', 'test/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
