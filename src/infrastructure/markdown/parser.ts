import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Position } from 'unist';
import { visitParents } from 'unist-util-visit-parents';
import type { Heading } from '../../domain/note/note.js';
import { findReferences, type Reference } from '../../domain/reference/reference.js';
import type { SourceRange } from '../../domain/text/text-edit.js';
import type { MarkdownParser, ParsedMarkdown } from '../../application/ports.js';
import { renderMarkdown } from './render.js';

const processor = unified().use(remarkParse).use(remarkGfm);

/** Text inside a link is not prose we may reference or wrap: links cannot nest. */
const INSIDE_LINK = new Set(['link', 'linkReference']);

/**
 * remark gives every node a source position. References are scanned on the *source slice* of
 * each `text` node (never on `node.value`, which has escapes and entities decoded), so their
 * ranges are exact and code spans, fenced blocks and URLs are structurally excluded.
 */
export const createMarkdownParser = (): MarkdownParser => ({
  parse(source, bodyStart): ParsedMarkdown {
    const tree = processor.parse(source.slice(bodyStart));
    const headings: Heading[] = [];
    const references: Reference[] = [];
    const textSpans: SourceRange[] = [];

    const rangeOf = (node: { position?: Position | undefined }) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      return start === undefined || end === undefined
        ? null
        : { start: bodyStart + start, end: bodyStart + end };
    };

    visitParents(tree, (node, ancestors) => {
      if (node.type === 'heading') {
        const range = rangeOf(node);
        if (range) headings.push({ depth: node.depth, text: mdastToString(node).trim(), range });
      } else if (node.type === 'text') {
        if (ancestors.some((a) => INSIDE_LINK.has(a.type))) return;
        const range = rangeOf(node);
        if (!range) return;
        textSpans.push(range);
        references.push(...findReferences(source.slice(range.start, range.end), range.start));
      }
    });

    return { headings, references, textSpans };
  },

  render(source, bodyStart, options) {
    return renderMarkdown(processor.parse(source.slice(bodyStart)), source, bodyStart, options);
  },
});
