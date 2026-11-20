import { extractFields, type FieldValue } from './fields.js';
import type { EntryId } from './entry-id.js';
import type { AnyEntry, Visibility } from './entry.js';

/*
 * The index row of a note: everything `list`, `search` and resolution need without reading
 * the file. Derived from a `AnyEntry`; the file remains the source of truth.
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

export interface EntrySummary extends SummaryBase {
  readonly kind: 'entry';
  readonly id: EntryId;
}

export interface UnidentifiedSummary extends SummaryBase {
  readonly kind: 'unidentified';
}

export type AnySummary = EntrySummary | UnidentifiedSummary;

export const isEntrySummary = (summary: AnySummary): summary is EntrySummary =>
  summary.kind === 'entry';

export const summarize = (entry: AnyEntry): AnySummary => {
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
    kind: 'entry',
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
