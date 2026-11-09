import { conflict, type AppError } from '../../domain/errors.js';
import type { Note } from '../../domain/note/note.js';
import { escapeMarkdownText } from '../../domain/publishing/output-path.js';
import type { PublicationPlan } from '../../domain/publishing/plan.js';
import { err, ok, type Result } from '../../domain/result.js';
import { applyEdits, replaceRange, type TextEdit } from '../../domain/text/text-edit.js';
import type { Destination, Located } from './destination.js';

/*
 * Rewrites every `[[id]]` reference in a note's body for one destination, returning the body text
 * (frontmatter dropped). A published target becomes a real link via the destination; an excluded
 * or unresolved target is stripped to its label (`strip-to-label`) or left verbatim (`keep-id` —
 * and `fail`, which never reaches here because such a plan is unpublishable).
 *
 * An Obsidian embed (`![[id]]`) includes its leading `!` in the edit and re-emits it escaped
 * (`\!`) so the published Markdown shows a literal `!` rather than an image embed.
 */
export const rewriteReferences = (
  note: Note,
  plan: PublicationPlan,
  destination: Destination,
  options: unknown,
  located: ReadonlyMap<string, Located>,
  from: Located,
): Result<string, AppError> => {
  const policy = plan.publication.references;
  const edits: TextEdit[] = [];
  for (const reference of note.references) {
    const id = reference.target as string;
    const target = plan.targets.get(id);
    if (!target) {
      return err(conflict(`${note.path} references ${id}, which is absent from the plan`, { id }));
    }
    const bang = reference.range.start > 0 && note.source[reference.range.start - 1] === '!';
    const start = bang ? reference.range.start - 1 : reference.range.start;
    const prefix = bang ? '\\!' : '';
    const label = reference.label ?? escapeMarkdownText(target.title ?? id);
    if (target.state === 'published') {
      const to = located.get(id);
      if (!to) return err(conflict(`${note.path} links to ${id}, which is not located`, { id }));
      const link = destination.linkTo(from, to, options);
      edits.push(replaceRange({ start, end: reference.range.end }, `${prefix}[${label}](${link})`));
    } else if (policy === 'strip-to-label') {
      edits.push(replaceRange({ start, end: reference.range.end }, `${prefix}${label}`));
    }
    // keep-id (and fail): leave the reference verbatim.
  }
  const applied = applyEdits(note.source, edits);
  // Every reference lives in the body, so the untouched frontmatter prefix keeps its length.
  return applied.ok ? ok(applied.value.slice(note.body.start)) : applied;
};
