import { parseNoteId } from '../../domain/note/note-id.js';
import { readFrontmatterFields, splitFrontmatter } from '../../domain/note/frontmatter.js';
import { resolveTitle, type NoteEntry } from '../../domain/note/note.js';
import type { AppDeps, NoteDocument } from '../ports.js';

/**
 * Turns a stored document into a domain entry. Never fails: malformed frontmatter or an invalid
 * id degrade the file to an `UnidentifiedNote` with `issues`, so one bad file cannot hide a
 * vault from `list` or `doctor`.
 */
export const loadNoteEntry = (
  deps: Pick<AppDeps, 'markdown' | 'frontmatter'>,
  doc: Pick<NoteDocument, 'path' | 'source' | 'version'>,
): NoteEntry => {
  const issues: string[] = [];
  const block = splitFrontmatter(doc.source);
  let data: Record<string, unknown> = {};
  if (block) {
    const parsed = deps.frontmatter.parse(block.yaml);
    if (parsed.ok) data = parsed.value;
    else issues.push(`frontmatter: ${parsed.error.message}`);
  }
  const bodyStart = block ? block.blockRange.end : 0;
  const markdown = deps.markdown.parse(doc.source, bodyStart);
  const fields = readFrontmatterFields(data);
  issues.push(...fields.issues);

  const base = {
    path: doc.path,
    title: resolveTitle(fields.title, markdown.headings, doc.path),
    source: doc.source,
    version: doc.version,
    frontmatter: data,
    body: { start: bodyStart, end: doc.source.length },
    headings: markdown.headings,
    references: markdown.references,
  };

  if (fields.id === undefined) return { kind: 'unidentified', ...base, issues };
  const id = parseNoteId(fields.id);
  if (!id.ok) {
    issues.push(`id: ${id.error.message}`);
    return { kind: 'unidentified', ...base, issues };
  }
  return {
    kind: 'note',
    ...base,
    id: id.value,
    aliases: fields.aliases,
    dates: fields.dates,
    tags: fields.tags,
    visibility: fields.visibility,
    ...(fields.type !== undefined && { type: fields.type }),
    ...(fields.slug !== undefined && { slug: fields.slug }),
    issues,
  };
};
