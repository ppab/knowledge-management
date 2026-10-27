import type {
  BlockContent,
  DefinitionContent,
  List,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast';
import type { Position } from 'unist';
import { findReferences } from '../../domain/reference/reference.js';
import type { RenderedLine, Span, SpanStyle } from '../../domain/text/rendered.js';
import type { SourceRange } from '../../domain/text/text-edit.js';
import type { RenderOptions } from '../../application/ports.js';

/*
 * mdast → terminal lines (docs/architecture.md §4, "TUI rendered↔source map"). Prose is shown
 * as the exact source slice of each `text` node, so escapes and entities appear as written and
 * every source-backed span satisfies `source.slice(start, end) === text`. Structure that has no
 * source text of its own (bullets, heading markers, quote bars, continuation indents) is
 * synthetic. Blocks the terminal cannot improve on (code, tables, raw HTML) are shown verbatim,
 * line by line, still mapped to the source.
 */

interface Prefix {
  readonly first: string;
  readonly rest: string;
}

const synthetic = (text: string, style?: SpanStyle): Span => (style ? { text, style } : { text });

const withStyle = (span: Span, style: SpanStyle): Span =>
  Object.keys(style).length === 0 ? span : { ...span, style: { ...span.style, ...style } };

/** Splits a source-backed span at `at` characters in; both halves keep an exact mapping. */
const splitSpan = (span: Span, at: number): [Span, Span] => {
  const head = span.text.slice(0, at);
  const tail = span.text.slice(at);
  const source = span.source;
  const base = (text: string, range: SourceRange | undefined): Span => ({
    ...span,
    text,
    ...(range ? { source: range } : {}),
  });
  if (!source) {
    const { source: _s, ...rest } = span;
    return [
      { ...rest, text: head },
      { ...rest, text: tail },
    ];
  }
  return [
    base(head, { start: source.start, end: source.start + at }),
    base(tail, { start: source.start + at, end: source.end }),
  ];
};

const mergeable = (a: Span, b: Span): boolean =>
  a.reference === undefined &&
  b.reference === undefined &&
  JSON.stringify(a.style ?? {}) === JSON.stringify(b.style ?? {}) &&
  (a.source === undefined) === (b.source === undefined) &&
  (a.source === undefined || b.source === undefined || a.source.end === b.source.start);

const merge = (spans: readonly Span[]): Span[] => {
  const out: Span[] = [];
  for (const span of spans) {
    if (span.text === '') continue;
    const last = out[out.length - 1];
    if (last && mergeable(last, span)) {
      out[out.length - 1] = {
        ...last,
        text: last.text + span.text,
        ...(last.source && span.source
          ? { source: { start: last.source.start, end: span.source.end } }
          : {}),
      };
    } else {
      out.push(span);
    }
  }
  return out;
};

/** Greedy word wrap; a reference span is one unbreakable token. */
const wrap = (spans: readonly Span[], width: number, prefix: Prefix): RenderedLine[] => {
  const lines: Span[][] = [];
  let current: Span[] = [synthetic(prefix.first, { dim: true })];
  // Mutated from closures below, so kept in an object (control-flow narrowing would lie).
  const at = { column: prefix.first.length, lineStart: true };

  const newline = () => {
    // Whitespace that ended up at the break is not shown; the map stays exact for what is.
    while (current.length > 1 && /^\s+$/.test(current[current.length - 1]?.text ?? 'x')) {
      current.pop();
    }
    lines.push(current);
    current = [synthetic(prefix.rest, { dim: true })];
    at.column = prefix.rest.length;
    at.lineStart = true;
  };
  const place = (piece: Span) => {
    current.push(piece);
    at.column += piece.text.length;
    at.lineStart = false;
  };

  const pieces: Span[] = [];
  for (const span of spans) {
    if (span.reference !== undefined || width <= 0) {
      pieces.push(span);
      continue;
    }
    let rest = span;
    while (rest.text !== '') {
      const match = /^(\s+|\S+)/.exec(rest.text);
      const length = match?.[0].length ?? rest.text.length;
      const [piece, remainder] = splitSpan(rest, length);
      pieces.push(piece);
      rest = remainder;
    }
  }

  for (let piece of pieces) {
    const blank = /^\s+$/.test(piece.text);
    if (width <= 0) {
      place(piece);
      continue;
    }
    if (blank && at.lineStart) continue;
    if (at.column + piece.text.length > width && !at.lineStart) {
      newline();
      if (blank) continue;
    }
    // A single token wider than the line is cut hard rather than overflowing.
    while (
      piece.text.length > width - at.column &&
      width - at.column > 0 &&
      piece.reference === undefined
    ) {
      const [head, tail] = splitSpan(piece, width - at.column);
      place(head);
      newline();
      piece = tail;
    }
    place(piece);
  }
  lines.push(current);
  return lines.map((line) => ({ spans: merge(line) }));
};

export const renderMarkdown = (
  tree: Root,
  source: string,
  bodyStart: number,
  options: RenderOptions,
): RenderedLine[] => {
  const out: RenderedLine[] = [];
  let referenceIndex = 0;

  const rangeOf = (node: { position?: Position | undefined }): SourceRange | null => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined
      ? null
      : { start: bodyStart + start, end: bodyStart + end };
  };
  const slice = (range: SourceRange): string => source.slice(range.start, range.end);

  /** The node's own source text, line by line, each line mapped exactly. */
  const verbatim = (node: RootContent, prefix: Prefix, style: SpanStyle): void => {
    const range = rangeOf(node);
    if (!range) return;
    let offset = range.start;
    const lines = slice(range).split('\n');
    lines.forEach((text, i) => {
      const span: Span = { text, source: { start: offset, end: offset + text.length }, style };
      out.push({
        spans: merge([synthetic(i === 0 ? prefix.first : prefix.rest, { dim: true }), span]),
      });
      offset += text.length + 1;
    });
  };

  const textSpans = (range: SourceRange, style: SpanStyle, insideLink: boolean): Span[] => {
    const text = slice(range);
    if (insideLink) return [withStyle({ text, source: range }, style)];
    const spans: Span[] = [];
    let cursor = range.start;
    for (const ref of findReferences(text, range.start)) {
      if (ref.range.start > cursor) {
        spans.push(
          withStyle(
            {
              text: source.slice(cursor, ref.range.start),
              source: { start: cursor, end: ref.range.start },
            },
            style,
          ),
        );
      }
      const index = referenceIndex++;
      const label = options.referenceText?.(ref, index) ?? ref.label ?? ref.target;
      spans.push({ text: label, reference: index, style });
      cursor = ref.range.end;
    }
    if (cursor < range.end) {
      spans.push(
        withStyle(
          { text: source.slice(cursor, range.end), source: { start: cursor, end: range.end } },
          style,
        ),
      );
    }
    return spans;
  };

  /** Phrasing content as logical lines (hard breaks split them). */
  const inline = (
    nodes: readonly PhrasingContent[],
    style: SpanStyle,
    insideLink: boolean,
  ): Span[][] => {
    const lines: Span[][] = [[]];
    const push = (span: Span) => lines[lines.length - 1]?.push(span);
    const append = (more: Span[][]) => {
      const [first, ...rest] = more;
      if (first) first.forEach(push);
      lines.push(...rest);
    };
    for (const node of nodes) {
      switch (node.type) {
        case 'text': {
          const range = rangeOf(node);
          if (range) textSpans(range, style, insideLink).forEach(push);
          break;
        }
        case 'emphasis':
          append(inline(node.children, { ...style, italic: true }, insideLink));
          break;
        case 'strong':
          append(inline(node.children, { ...style, bold: true }, insideLink));
          break;
        case 'delete':
          append(inline(node.children, { ...style, strikethrough: true }, insideLink));
          break;
        case 'link':
          append(inline(node.children, { ...style, link: true }, true));
          push(synthetic(` (${node.url})`, { ...style, dim: true }));
          break;
        case 'linkReference':
          append(inline(node.children, { ...style, link: true }, true));
          break;
        case 'image':
          push(synthetic(`[image: ${node.alt ?? node.url}]`, { ...style, dim: true }));
          break;
        case 'break':
          lines.push([]);
          break;
        default: {
          // inlineCode, html, footnoteReference, imageReference: shown as written.
          const range = rangeOf(node);
          if (range) {
            push(
              withStyle(
                { text: slice(range), source: range },
                {
                  ...style,
                  ...(node.type === 'inlineCode' && { code: true }),
                },
              ),
            );
          }
        }
      }
    }
    return lines;
  };

  const paragraphLike = (
    nodes: readonly PhrasingContent[],
    style: SpanStyle,
    prefix: Prefix,
    marker = '',
  ): void => {
    const logical = inline(nodes, style, false);
    logical.forEach((spans, i) => {
      const linePrefix: Prefix = {
        first: (i === 0 ? prefix.first : prefix.rest) + (i === 0 ? marker : ''),
        rest: prefix.rest + ' '.repeat(marker.length),
      };
      out.push(...wrap(spans, options.width, linePrefix));
    });
  };

  const blank = (prefix: Prefix): void => {
    const text = prefix.rest.trimEnd();
    out.push({ spans: text === '' ? [] : [synthetic(text, { dim: true })] });
  };

  const list = (node: List, prefix: Prefix): void => {
    const start = node.start ?? 1;
    node.children.forEach((item, i) => {
      if (i > 0 && node.spread) blank(prefix);
      const bullet = node.ordered ? `${String(start + i)}. ` : '- ';
      const task = typeof item.checked !== 'boolean' ? '' : item.checked ? '[x] ' : '[ ] ';
      const marker = bullet + task;
      const itemPrefix: Prefix = {
        first: prefix.rest + marker,
        rest: prefix.rest + ' '.repeat(marker.length),
      };
      blocks(item.children, { first: itemPrefix.first, rest: itemPrefix.rest }, true);
    });
  };

  const blocks = (
    nodes: readonly (BlockContent | DefinitionContent | RootContent)[],
    prefix: Prefix,
    tight = false,
  ): void => {
    nodes.forEach((node, i) => {
      if (i > 0 && !tight) blank(prefix);
      const first = i === 0 ? prefix : { first: prefix.rest, rest: prefix.rest };
      switch (node.type) {
        case 'paragraph':
          paragraphLike(node.children, {}, first);
          break;
        case 'heading':
          paragraphLike(
            node.children,
            { bold: true, heading: node.depth },
            first,
            `${'#'.repeat(node.depth)} `,
          );
          break;
        case 'list':
          list(node, first);
          break;
        case 'blockquote':
          blocks(node.children, { first: first.first + '> ', rest: first.rest + '> ' });
          break;
        case 'code':
          verbatim(node, first, { code: true });
          break;
        case 'thematicBreak':
          out.push({
            spans: [
              synthetic(
                first.first +
                  '─'.repeat(Math.max(3, Math.min(options.width, 40) - first.first.length)),
                { dim: true },
              ),
            ],
          });
          break;
        default:
          // html, table, definition, footnoteDefinition, yaml, math…: verbatim.
          verbatim(node, first, {});
      }
    });
  };

  blocks(tree.children, { first: '', rest: '' });
  while (out.length > 0 && out[out.length - 1]?.spans.length === 0) out.pop();
  return out;
};
