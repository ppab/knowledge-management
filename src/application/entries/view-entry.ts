import { notFound, unavailable, type AppError } from '../../domain/errors.js';
import { isEntry, type AnyEntry } from '../../domain/entry/entry.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import type { RenderedLine } from '../../domain/text/rendered.js';
import type { AppDeps } from '../ports.js';
import { resolveTarget, type OutgoingReference } from '../references/references.js';
import {
  readEntryInScope,
  withScope,
  type IndexedEntry,
  type ScopeSession,
} from '../scope/session.js';
import type { VaultHandle } from '../vault/vault.js';
import { loadEntry } from './load-entry.js';

/*
 * What a viewer needs for one note: the entry as read from disk, where each of its references
 * leads, and the vault it lives in. Identified notes are addressed by query (id, title, alias)
 * like everywhere else; unidentified files, which have no id to resolve, by vault and path.
 */

export type EntryLocator =
  { readonly query: string } | { readonly vault: string; readonly path: string };

export interface ViewedEntry extends LocatedEntry {
  readonly references: readonly OutgoingReference[];
}

export interface LocatedEntry {
  readonly vault: VaultHandle;
  readonly entry: AnyEntry;
  /** Set when the entry is an identified note; what panels and mutations take. */
  readonly located?: IndexedEntry;
}

const readByPath = async (
  deps: AppDeps,
  session: ScopeSession,
  vaultName: string,
  path: string,
): Promise<Result<LocatedEntry, AppError>> => {
  const opened = session.opened.find((o) => o.vault.config.name === vaultName);
  if (!opened) {
    return session.unavailable.length > 0
      ? err(unavailable(`Vault ${vaultName} is not available`, { vault: vaultName }))
      : err(notFound(`No vault "${vaultName}" in this scope`, { vault: vaultName }));
  }
  const doc = await deps.entries.read(opened.vault.root, path);
  if (!doc.ok) return doc;
  const entry = loadEntry(deps, doc.value);
  return ok({
    vault: opened.vault,
    entry,
    ...(isEntry(entry) && { located: { vault: opened.vault, index: opened.index, note: entry } }),
  });
};

/** The file behind a locator: resolved through the index by query, or read directly by path. */
export const locateEntry = async (
  deps: AppDeps,
  session: ScopeSession,
  locator: EntryLocator,
): Promise<Result<LocatedEntry, AppError>> => {
  if ('vault' in locator) return readByPath(deps, session, locator.vault, locator.path);
  const located = await readEntryInScope(deps, session, locator.query);
  if (!located.ok) return located;
  return ok({ vault: located.value.vault, entry: located.value.note, located: located.value });
};

export const viewEntry = (
  deps: AppDeps,
  scope: Scope,
  locator: EntryLocator,
): Promise<Result<ViewedEntry, AppError>> =>
  withScope(deps, scope, async (session) => {
    const read = await locateEntry(deps, session, locator);
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
export const renderEntry = (deps: AppDeps, viewed: ViewedEntry, width: number): RenderedLine[] =>
  deps.markdown.render(viewed.entry.source, viewed.entry.body.start, {
    width,
    referenceText: (_ref, index) => {
      const reference = viewed.references[index];
      return reference ? referenceDisplay(reference) : (_ref.label ?? _ref.target);
    },
  });
