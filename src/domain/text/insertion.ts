import { ambiguous, notFound, usage, type AppError } from '../errors.js';
import type { Heading } from '../note/note.js';
import { err, ok, type Result } from '../result.js';
import { insertAt, type TextEdit } from './text-edit.js';

/*
 * Where a block of Markdown goes when it is added to a note. Locations are resolved against
 * the parsed heading structure and produce a single insertion edit; nothing else moves.
 */

export type InsertionLocation =
  | { readonly kind: 'end' }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'references' };

export const REFERENCES_HEADING = 'References';

/** `end` | `heading:<text>` | `references`, as typed on the command line. */
export const parseInsertionLocation = (input: string): Result<InsertionLocation, AppError> => {
  if (input === 'end') return ok({ kind: 'end' });
  if (input === 'references') return ok({ kind: 'references' });
  if (input.startsWith('heading:')) {
    const text = input.slice('heading:'.length).trim();
    if (text !== '') return ok({ kind: 'heading', text });
  }
  return err(usage(`Unknown location "${input}" (end, heading:<text>, references)`));
};

export interface DocumentLayout {
  readonly source: string;
  readonly bodyStart: number;
  readonly headings: readonly Heading[];
}

/** Offset just past the last non-whitespace character in `[start, end)`, or `start`. */
const contentEnd = (source: string, start: number, end: number): number => {
  let at = end;
  while (at > start && /\s/.test(source.charAt(at - 1))) at -= 1;
  return at;
};

/**
 * Inserts `block` as its own paragraph at the end of a section's content, before whatever
 * whitespace (and the next heading) follows. The existing bytes are never rewritten; a
 * trailing newline is added only when the block becomes the end of the file.
 */
const appendToSection = (
  layout: DocumentLayout,
  sectionStart: number,
  sectionEnd: number,
  block: string,
): TextEdit => {
  const at = contentEnd(layout.source, sectionStart, sectionEnd);
  const emptyBody = at === layout.bodyStart;
  const separator = emptyBody ? (layout.bodyStart === 0 ? '' : '\n') : '\n\n';
  const tail = layout.source.slice(at).includes('\n') ? '' : '\n';
  return insertAt(at, separator + block + tail);
};

const sectionEndOf = (headings: readonly Heading[], heading: Heading, length: number): number => {
  const index = headings.indexOf(heading);
  for (const next of headings.slice(index + 1)) {
    if (next.depth <= heading.depth) return next.range.start;
  }
  return length;
};

const findHeading = (
  headings: readonly Heading[],
  text: string,
): Result<Heading | null, AppError> => {
  const needle = text.trim().toLowerCase();
  const matches = headings.filter((h) => h.text.toLowerCase() === needle);
  const [first, second] = matches;
  if (second) {
    return err(
      ambiguous(`${String(matches.length)} headings are titled "${text}"`, {
        heading: text,
        lines: matches.map((h) => h.range.start),
      }),
    );
  }
  return ok(first ?? null);
};

export interface InsertionPlan {
  readonly edit: TextEdit;
  /** Headings the insertion itself introduces (a created `## References` section). */
  readonly addsHeadings: readonly Pick<Heading, 'depth' | 'text'>[];
}

export const locateInsertion = (
  layout: DocumentLayout,
  location: InsertionLocation,
  block: string,
): Result<InsertionPlan, AppError> => {
  const { source, bodyStart, headings } = layout;
  const atEnd = (text: string): TextEdit => appendToSection(layout, bodyStart, source.length, text);
  const under = (heading: Heading): Result<InsertionPlan, AppError> =>
    ok({
      edit: appendToSection(
        layout,
        heading.range.end,
        sectionEndOf(headings, heading, source.length),
        block,
      ),
      addsHeadings: [],
    });

  switch (location.kind) {
    case 'end':
      return ok({ edit: atEnd(block), addsHeadings: [] });
    case 'heading': {
      const heading = findHeading(headings, location.text);
      if (!heading.ok) return heading;
      if (heading.value === null) {
        return err(
          notFound(`No heading "${location.text}" in the note`, {
            heading: location.text,
            headings: headings.map((h) => h.text),
          }),
        );
      }
      return under(heading.value);
    }
    case 'references': {
      const heading = findHeading(headings, REFERENCES_HEADING);
      if (!heading.ok) return heading;
      return heading.value === null
        ? ok({
            edit: atEnd(`## ${REFERENCES_HEADING}\n\n${block}`),
            addsHeadings: [{ depth: 2, text: REFERENCES_HEADING }],
          })
        : under(heading.value);
    }
  }
};
