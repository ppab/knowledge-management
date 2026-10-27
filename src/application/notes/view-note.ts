import { notFound, unavailable, type AppError } from '../../domain/errors.js';
import { isNote, type NoteEntry } from '../../domain/note/note.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { RenderedLine } from '../../domain/text/rendered.js';
import type { AppDeps } from '../ports.js';
import { resolveTarget, type OutgoingReference } from '../references/references.js';
import {
  readNoteInScope,
  withScope,
  type LocatedNote,
  type ScopeSession,
} from '../scope/session.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadNoteEntry } from './load-note.js';

/*
 * What a viewer needs for one note: the entry as read from disk, where each of its references
 * leads, and the vault it lives in. Identified notes are addressed by query (id, title, alias)
 * like everywhere else; unidentified files, which have no id to resolve, by vault and path.
 */

export type NoteLocator =
  { readonly query: string } | { readonly vault: string; readonly path: string };

export interface ViewedNote {
  readonly vault: VaultHandle;
  readonly entry: NoteEntry;
  readonly references: readonly OutgoingReference[];
  /** Set when the entry is an identified note; what panels and mutations take. */
  readonly located?: LocatedNote;
}

const readByPath = async (
  deps: AppDeps,
  session: ScopeSession,
  vaultName: string,
  path: string,
): Promise<Result<{ vault: VaultHandle; entry: NoteEntry; located?: LocatedNote }, AppError>> => {
  const opened = session.opened.find((o) => o.vault.config.name === vaultName);
  if (!opened) {
    return session.unavailable.length > 0
      ? err(unavailable(`Vault ${vaultName} is not available`, { vault: vaultName }))
      : err(notFound(`No vault "${vaultName}" in this scope`, { vault: vaultName }));
  }
  const doc = await deps.notes.read(opened.vault.root, path);
  if (!doc.ok) return doc;
  const entry = loadNoteEntry(deps, doc.value);
  return ok({
    vault: opened.vault,
    entry,
    ...(isNote(entry) && { located: { vault: opened.vault, index: opened.index, note: entry } }),
  });
};

const readByQuery = async (
  deps: AppDeps,
  session: ScopeSession,
  query: string,
): Promise<Result<{ vault: VaultHandle; entry: NoteEntry; located?: LocatedNote }, AppError>> => {
  const located = await readNoteInScope(deps, session, query);
  if (!located.ok) return located;
  return ok({ vault: located.value.vault, entry: located.value.note, located: located.value });
};

export const viewNote = (
  deps: AppDeps,
  scope: Scope,
  locator: NoteLocator,
): Promise<Result<ViewedNote, AppError>> =>
  withScope(deps, scope, async (session) => {
    const read =
      'query' in locator
        ? await readByQuery(deps, session, locator.query)
        : await readByPath(deps, session, locator.vault, locator.path);
    if (!read.ok) return read;
    const { vault, entry, located } = read.value;
    const references = entry.references.map((ref): OutgoingReference => ({
      target: ref.target,
      ...(ref.label !== undefined && { label: ref.label }),
      range: ref.range,
      resolution: resolveTarget(session, ref.target),
    }));
    return ok({ vault, entry, references, ...(located && { located }) });
  });

/** How a reference reads on screen: its label, else the target's current title, else its id. */
export const referenceDisplay = (reference: OutgoingReference): string => {
  const r = reference.resolution;
  const label = reference.label ?? (r.state === 'resolved' ? r.note.title : reference.target);
  switch (r.state) {
    case 'resolved':
      return label;
    case 'unresolved':
      return `${label} [missing]`;
    case 'ambiguous':
      return `${label} [ambiguous]`;
    case 'unavailable':
      return `${label} [unavailable]`;
  }
};

/** The body as terminal lines; reference spans are numbered like `viewed.references`. */
export const renderNote = (deps: AppDeps, viewed: ViewedNote, width: number): RenderedLine[] =>
  deps.markdown.render(viewed.entry.source, viewed.entry.body.start, {
    width,
    referenceText: (_ref, index) => {
      const reference = viewed.references[index];
      return reference ? referenceDisplay(reference) : (_ref.label ?? _ref.target);
    },
  });
