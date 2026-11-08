import { conflict, unavailable, validation, type AppError } from '../../domain/errors.js';
import { splitFrontmatter } from '../../domain/note/frontmatter.js';
import { findPathCollisions } from '../../domain/publishing/collisions.js';
import { buildManifest } from '../../domain/publishing/manifest.js';
import { normalizeOutputPath } from '../../domain/publishing/output-path.js';
import type { PublicationPlan } from '../../domain/publishing/plan.js';
import { err, ok, type Result } from '../../domain/result.js';
import { loadNoteEntry } from '../notes/load-note.js';
import type { AppDeps } from '../ports.js';
import type { ScopeSession } from '../scope/session.js';
import {
  manifestPathOf,
  type Located,
  type RenderTools,
  type ResolvedPublication,
} from './destination.js';
import { rewriteReferences } from './rewrite-references.js';

/*
 * Writes a publishable plan to the output directory. Nothing is written until everything is
 * rendered, so a path collision, a note that drifted since it was indexed, or a render failure
 * all abort before the first file lands. Source notes are only ever read, never written.
 */

export interface PublishReport {
  readonly outputDir: string;
  /** Output-dir-relative paths written, in write order (content files, then the manifest). */
  readonly files: readonly string[];
}

export const executePublication = async (
  deps: AppDeps,
  session: ScopeSession,
  resolved: ResolvedPublication,
  plan: PublicationPlan,
): Promise<Result<PublishReport, AppError>> => {
  const { destination, options } = resolved;

  const located = new Map<string, Located>();
  const pathEntries: { id: string; path: string }[] = [];
  for (const entry of plan.entries) {
    const normalized = normalizeOutputPath(destination.pathFor(entry, options));
    if (!normalized.ok) return normalized;
    located.set(entry.id, { entry, path: normalized.value });
    pathEntries.push({ id: entry.id, path: normalized.value });
  }
  const collisions = findPathCollisions(pathEntries);
  if (collisions.length > 0) {
    return err(
      validation(`Output paths collide: ${collisions.map((c) => c.key).join(', ')}`, { collisions }),
    );
  }

  const tools: RenderTools = {
    toHtml: (markdown) => deps.markdown.toHtml(markdown),
    updateFrontmatter: (yaml, update) => deps.frontmatter.update(yaml, update),
  };
  const openedByName = new Map(session.opened.map((o) => [o.vault.config.name, o]));

  const files: { path: string; content: string }[] = [];
  for (const entry of plan.entries) {
    const opened = openedByName.get(entry.vault);
    if (!opened) return err(unavailable(`Vault ${entry.vault} is not open`, { vault: entry.vault }));
    const doc = await deps.notes.read(opened.vault.root, entry.path);
    if (!doc.ok) return doc;
    if (doc.value.version !== entry.version) {
      return err(conflict(`${entry.path} changed since it was indexed; refresh and retry`, { path: entry.path }));
    }
    const note = loadNoteEntry(deps, doc.value);
    if (note.kind !== 'note' || note.id !== entry.id) {
      return err(conflict(`${entry.path} changed while publishing; retry`, { path: entry.path }));
    }
    const from = located.get(entry.id);
    if (!from) return err(conflict(`${entry.path} is not located`, { path: entry.path }));
    const body = rewriteReferences(note, plan, destination, options, located, from);
    if (!body.ok) return body;
    const block = splitFrontmatter(note.source);
    const rendered = destination.render(
      {
        entry,
        path: from.path,
        frontmatterYaml: block ? block.yaml : '',
        frontmatter: note.frontmatter,
        body: body.value,
      },
      tools,
      options,
    );
    if (!rendered.ok) return rendered;
    files.push({ path: from.path, content: rendered.value });
  }

  const paths = new Map([...located].map(([id, l]) => [id, l.path]));
  const manifest = buildManifest(plan, paths);
  files.push({
    path: manifestPathOf(destination, options),
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  });

  for (const file of files) {
    const written = await deps.outputs.write(plan.outputDir, file.path, file.content);
    if (!written.ok) return written;
  }
  return ok({ outputDir: plan.outputDir, files: files.map((f) => f.path) });
};
