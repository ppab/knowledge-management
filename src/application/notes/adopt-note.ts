import { validation, type AppError } from '../../domain/errors.js';
import { generateNoteId } from '../../domain/identity/identity.js';
import { splitFrontmatter, wrapFrontmatter } from '../../domain/note/frontmatter.js';
import type { NoteId } from '../../domain/note/note-id.js';
import { err, ok, type Result } from '../../domain/result.js';
import { applyEdits, insertAt, replaceRange } from '../../domain/text/text-edit.js';
import { normalizeVaultPath } from '../../domain/vault/paths.js';
import type { AppDeps } from '../ports.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';

export interface AdoptedNote {
  readonly path: string;
  readonly id: NoteId;
}

/**
 * Assigns an identity to a Markdown file that has none. The only change to the file is the
 * added `id` key: existing frontmatter (comments, order, unknown keys) and the body are left
 * byte-for-byte intact.
 */
export interface AdoptNoteInput {
  readonly path: string;
  /** Note type for `{type}` identity formats when the file's frontmatter has none. */
  readonly type?: string;
}

export const adoptNote = async (
  deps: AppDeps,
  vault: VaultHandle,
  input: AdoptNoteInput,
): Promise<Result<AdoptedNote, AppError>> => {
  const path = normalizeVaultPath(input.path);
  if (!path.ok) return path;
  const doc = await deps.notes.read(vault.root, path.value);
  if (!doc.ok) return doc;

  const entry = loadNoteEntry(deps, doc.value);
  if (entry.kind === 'note') {
    return err(validation(`${path.value} already has id ${entry.id}`, { path: path.value }));
  }
  const existingId = entry.frontmatter.id;
  if (existingId !== undefined && existingId !== null) {
    return err(
      validation(`${path.value} has an invalid id that must be fixed by hand`, {
        path: path.value,
        issues: entry.issues,
      }),
    );
  }

  const type = typeof entry.frontmatter.type === 'string' ? entry.frontmatter.type : input.type;
  const { identity } = vault.config;
  if (
    type === undefined &&
    identity.strategy === 'formatted' &&
    identity.format.includes('{type}')
  ) {
    return err(
      validation(
        `Identity format "${identity.format}" needs a type: pass --type or set "type:" in ${path.value}`,
        { path: path.value },
      ),
    );
  }
  const id = generateNoteId(
    vault.config.identity,
    { vault: vault.config.name, ...(type !== undefined && { type }), date: deps.clock.now() },
    deps.unique,
  );
  if (!id.ok) return id;

  const block = splitFrontmatter(doc.value.source);
  const yaml = deps.frontmatter.update(block?.yaml ?? '', { set: { id: id.value } });
  if (!yaml.ok) return yaml;
  const edit = block
    ? replaceRange(block.yamlRange, yaml.value)
    : insertAt(0, wrapFrontmatter(yaml.value));
  const next = applyEdits(doc.value.source, [edit]);
  if (!next.ok) return next;

  const written = await deps.notes.write(vault.root, path.value, next.value, {
    expectedVersion: doc.value.version,
  });
  if (!written.ok) return written;
  return ok({ path: path.value, id: id.value });
};
