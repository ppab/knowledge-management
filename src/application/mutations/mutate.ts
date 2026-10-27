import { appError, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import type { Heading, Note } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';
import { unifiedDiff } from '../../domain/text/diff.js';
import { applyEdits, type TextEdit } from '../../domain/text/text-edit.js';
import { refreshIndex } from '../index/refresh-index.js';
import { loadNoteEntry } from '../notes/load-note.js';
import type { AppDeps, NoteIndex } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';

/*
 * The one path every structured write takes (docs/architecture.md §4, "Safe mutation
 * strategy"): apply edits → re-parse → assert the change is exactly the intended one → write
 * with the version that was read → refresh that path in the index. `dryRun` stops after the
 * assertion and returns a unified diff instead.
 */

export type HeadingShape = Pick<Heading, 'depth' | 'text'>;

export interface MutationExpectations {
  /** Change in the number of references the note makes. */
  readonly referenceDelta: number;
  /** Headings the inserted text itself introduces; any other heading change is a failure. */
  readonly addedHeadings?: readonly HeadingShape[];
  /** `unchanged`: the frontmatter text is identical; `changed`: the body is identical instead. */
  readonly frontmatter: 'unchanged' | 'changed';
}

export interface MutationOutcome {
  readonly path: string;
  readonly written: boolean;
  readonly dryRun: boolean;
  /** Unified diff of the change; present for dry runs. */
  readonly diff?: string;
  /** New content version after a write. */
  readonly version?: string;
}

const shapes = (headings: readonly HeadingShape[]): string[] =>
  headings.map((h) => `${String(h.depth)}:${h.text}`).sort();

const postConditionFailure = (
  note: Note,
  next: Note,
  expect: MutationExpectations,
): string | null => {
  const before = splitFrontmatter(note.source);
  const after = splitFrontmatter(next.source);
  if (expect.frontmatter === 'unchanged' && before?.yaml !== after?.yaml) {
    return 'frontmatter would change';
  }
  if (
    expect.frontmatter === 'changed' &&
    note.source.slice(note.body.start) !== next.source.slice(next.body.start)
  ) {
    return 'body would change';
  }
  const expectedHeadings = shapes([...note.headings, ...(expect.addedHeadings ?? [])]);
  if (shapes(next.headings).join('\n') !== expectedHeadings.join('\n')) {
    return 'heading structure would change';
  }
  const delta = next.references.length - note.references.length;
  if (delta !== expect.referenceDelta) {
    return `reference count would change by ${String(delta)}, expected ${String(expect.referenceDelta)}`;
  }
  return null;
};

export const mutateNote = async (
  deps: AppDeps,
  vault: VaultHandle,
  index: NoteIndex,
  note: Note,
  edits: readonly TextEdit[],
  expect: MutationExpectations,
  options: { readonly dryRun?: boolean } = {},
): Promise<Result<MutationOutcome, AppError>> => {
  const applied = applyEdits(note.source, edits);
  if (!applied.ok) return applied;
  const source = applied.value;
  const dryRun = options.dryRun ?? false;
  if (source === note.source) return ok({ path: note.path, written: false, dryRun });

  const next = loadNoteEntry(deps, { path: note.path, source, version: '' });
  const failure =
    next.kind !== 'note' || next.id !== note.id
      ? 'the note would lose its identity'
      : postConditionFailure(note, next, expect);
  if (failure !== null) {
    return err(
      appError('INTERNAL', `Refusing to write ${note.path}: ${failure}`, {
        path: note.path,
        diff: unifiedDiff(note.source, source, note.path),
      }),
    );
  }

  if (dryRun) {
    return ok({
      path: note.path,
      written: false,
      dryRun,
      diff: unifiedDiff(note.source, source, note.path),
    });
  }
  const written = await deps.notes.write(vault.root, note.path, source, {
    expectedVersion: note.version,
  });
  if (!written.ok) return written;
  // The file is the truth; if this refresh fails the next read refreshes anyway.
  await refreshIndex(deps, vault, index, { paths: [note.path] });
  return ok({ path: note.path, written: true, dryRun, version: written.value.version });
};
