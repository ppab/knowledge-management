/*
 * Compiles `notes` into single-file executables with Bun's bundler (`bun scripts/compile.ts`).
 * It runs under Bun, not Node, because the build API is Bun's; the program itself keeps Node as
 * its development runtime. Without arguments it builds every release target; `--host` builds
 * only the target this machine runs. Output: `release/notes-<os>-<arch>`.
 *
 * Ink imports `react-devtools-core` when `DEV=true` is set at run time. The package is not a
 * dependency, and a bundle cannot leave a dynamic import unresolved, so a plugin replaces it
 * with an empty module: the import only runs when someone sets DEV, and then does nothing.
 */
/* global Bun */

const TARGETS = ['bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-arm64', 'bun-darwin-x64'];
const ENTRY = 'src/interfaces/cli/main.ts';

const hostTarget = `bun-${process.platform}-${process.arch}`;
const targets = process.argv.includes('--host') ? [hostTarget] : TARGETS;

const stubDevtools = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default { initialize() {}, connectToDevTools() {} };',
      loader: 'js',
    }));
  },
};

for (const target of targets) {
  const outfile = `release/notes-${target.replace(/^bun-/, '')}`;
  const result = await Bun.build({
    entrypoints: [ENTRY],
    compile: { target, outfile },
    minify: true,
    sourcemap: 'linked',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [stubDevtools],
  });
  for (const log of result.logs) console.error(String(log));
  if (!result.success) process.exit(1);
  const bytes = Bun.file(outfile).size;
  console.log(`${outfile}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}
