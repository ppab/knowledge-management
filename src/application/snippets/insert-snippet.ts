import { validation, type AppError } from '../../domain/errors.js';
import { err, type Result } from '../../domain/result.js';
import type { Scope } from '../../domain/scope/scope.js';
import { renderTemplate, type TemplateVariables } from '../../domain/template/render.js';
import { locateInsertion, type InsertionLocation } from '../../domain/text/insertion.js';
import { mutateNote, type MutationOutcome } from '../mutations/mutate.js';
import { isoDate } from '../notes/create-note.js';
import { readNoteFile } from '../notes/show-note.js';
import type { AppDeps } from '../ports.js';
import { resolveInScope, withScope } from '../scope/session.js';
import { prepareSnippet } from '../templates/prepare-snippet.js';

export interface InsertSnippetInput {
  /** Note to edit: id, title or alias. */
  readonly note: string;
  /** Snippet name, looked up in the note's own vault. */
  readonly snippet: string;
  /** Overrides the snippet's own default location; `end` when neither says. */
  readonly at?: InsertionLocation;
  readonly variables?: TemplateVariables;
  readonly dryRun?: boolean;
}

/** Provided by the system; user variables cannot override them. */
const BUILTINS = ['id', 'title', 'date', 'datetime', 'vault'] as const;

export const insertSnippet = (
  deps: AppDeps,
  scope: Scope,
  input: InsertSnippetInput,
): Promise<Result<MutationOutcome, AppError>> =>
  withScope(deps, scope, async (session) => {
    // Resolution touches only the index; the file is read after the snippet is validated.
    const located = resolveInScope(session, input.note);
    if (!located.ok) return located;
    const { opened, summary } = located.value;
    const vault = opened.vault;

    const source = await deps.templates.getSnippet(vault.root, input.snippet);
    if (!source.ok) return source;
    const snippet = prepareSnippet(deps, source.value);
    if (!snippet.ok) return snippet;
    const provided = new Set<string>([
      ...Object.keys(snippet.value.defaults),
      ...Object.keys(input.variables ?? {}),
      ...BUILTINS,
    ]);
    const missing = snippet.value.variables.filter((v) => !provided.has(v));
    if (missing.length > 0) {
      return err(
        validation(`Snippet "${snippet.value.name}" needs variable(s): ${missing.join(', ')}`, {
          missing,
        }),
      );
    }

    const note = await readNoteFile(deps, vault, summary);
    if (!note.ok) return note;
    const now = deps.clock.now();
    const rendered = renderTemplate(snippet.value.body, {
      ...snippet.value.defaults,
      ...input.variables,
      id: note.value.id,
      title: note.value.title,
      date: isoDate(now),
      datetime: now.toISOString(),
      vault: vault.config.name,
    });
    if (!rendered.ok) return rendered;

    // What the fragment contributes on its own is what the note is expected to gain.
    const fragment = deps.markdown.parse(rendered.value, 0);
    const plan = locateInsertion(
      {
        source: note.value.source,
        bodyStart: note.value.body.start,
        headings: note.value.headings,
      },
      input.at ?? snippet.value.at ?? { kind: 'end' },
      rendered.value,
    );
    if (!plan.ok) return plan;
    return mutateNote(
      deps,
      vault,
      opened.index,
      note.value,
      [plan.value.edit],
      {
        referenceDelta: fragment.references.length,
        addedHeadings: [...fragment.headings, ...plan.value.addsHeadings],
        frontmatter: 'unchanged',
      },
      { dryRun: input.dryRun ?? false },
    );
  });
