import { extractFields, type FieldValue } from './fields.js';
import type { NoteId } from './note-id.js';
import type { NoteEntry, Visibility } from './note.js';

/*
 * The index row of a note: everything `list`, `search` and resolution need without reading
 * the file. Derived from a `NoteEntry`; the file remains the source of truth.
 */

interface SummaryBase {
  readonly path: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly dates: readonly string[];
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  readonly type?: string;
  readonly slug?: string;
  /** Frontmatter keys the core does not interpret; what plugins query by. */
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly version: string;
  readonly issues: readonly string[];
}

export interface NoteSummary extends SummaryBase {
  readonly kind: 'note';
  readonly id: NoteId;
}

export interface UnidentifiedSummary extends SummaryBase {
  readonly kind: 'unidentified';
}

export type EntrySummary = NoteSummary | UnidentifiedSummary;

export const isNoteSummary = (summary: EntrySummary): summary is NoteSummary =>
  summary.kind === 'note';

export const summarize = (entry: NoteEntry): EntrySummary => {
  const base = {
    path: entry.path,
    title: entry.title,
    fields: extractFields(entry.frontmatter),
    version: entry.version,
    issues: entry.issues,
  };
  if (entry.kind === 'unidentified') {
    return {
      kind: 'unidentified',
      ...base,
      aliases: [],
      dates: [],
      tags: [],
      visibility: 'private',
    };
  }
  return {
    kind: 'note',
    ...base,
    id: entry.id,
    aliases: entry.aliases,
    dates: entry.dates,
    tags: entry.tags,
    visibility: entry.visibility,
    ...(entry.type !== undefined && { type: entry.type }),
    ...(entry.slug !== undefined && { slug: entry.slug }),
  };
};
