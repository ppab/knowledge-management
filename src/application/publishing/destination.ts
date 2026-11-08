import type { AppError } from '../../domain/errors.js';
import type { Result } from '../../domain/result.js';
import type { Publication } from '../../domain/publishing/publication.js';
import type { PlanEntry } from '../../domain/publishing/plan.js';
import type { OpenVault } from '../../domain/vault/vault.js';
import type { FrontmatterUpdate } from '../ports.js';
import type { FieldSpec } from '../plugin/plugin.js';

/*
 * A destination decides how a planned publication becomes files: the output path of each entry,
 * the link from one entry to another, and the rendered content. The plan (domain) is
 * destination-agnostic; this is where layout and format live.
 *
 * Destinations are plugin-like. Built-in kinds live in the registry alongside plugins; a plugin
 * may contribute more. Like a plugin they declare `FieldSpec`s — frontmatter fields they read
 * from the *source* note — which `doctor` validates on the notes a publication selects.
 *
 * A destination reaches the system only through `RenderTools`, never `AppDeps` — the publishing
 * analogue of `PluginApi`.
 */

export interface RenderTools {
  /** GFM Markdown → HTML fragment. */
  toHtml(markdown: string): string;
  /** Builds frontmatter YAML from a base (often empty) and a set of changes. */
  updateFrontmatter(yaml: string, update: FrontmatterUpdate): Result<string, AppError>;
}

/** An entry together with its output-dir-relative file path. */
export interface Located {
  readonly entry: PlanEntry;
  readonly path: string;
}

export interface RenderInput {
  readonly entry: PlanEntry;
  readonly path: string;
  /** The source note's frontmatter YAML (inner text, no fences); empty when it had none. */
  readonly frontmatterYaml: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** The note body with its references already rewritten for this destination. */
  readonly body: string;
}

export interface Destination {
  readonly kind: string;
  readonly description: string;
  /** Validates and normalizes the publication's `options`; `{}` stands in when it has none. */
  readonly settings?: (raw: unknown) => Result<unknown, AppError>;
  /** Frontmatter fields read from source notes; doctor-validated on selected notes. */
  fields(options: unknown): readonly FieldSpec[];
  /** A route the layout dictates; a publication `route` that differs is a config error. */
  fixedRoute?(options: unknown): string | undefined;
  /** Where `manifest.json` lands, relative to the output dir; default `manifest.json`. */
  manifestPath?(options: unknown): string;
  pathFor(entry: PlanEntry, options: unknown): string;
  linkTo(from: Located, to: Located, options: unknown): string;
  render(input: RenderInput, tools: RenderTools, options: unknown): Result<string, AppError>;
}

/** A publication with its destination resolved and its options validated. */
export interface ResolvedPublication {
  readonly vault: OpenVault;
  readonly publication: Publication;
  readonly destination: Destination;
  readonly options: unknown;
}

/** Where `manifest.json` lands for a destination, honouring an override. */
export const manifestPathOf = (destination: Destination, options: unknown): string =>
  destination.manifestPath?.(options) ?? 'manifest.json';
