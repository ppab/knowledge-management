import type { PublicationPlan } from './plan.js';

/*
 * The manifest is the machine-readable index every publication emits alongside its files: enough
 * for a static-site generator to build navigation, feeds and links without re-parsing the output.
 * It carries no timestamp, so a given plan always produces byte-identical JSON (golden-testable).
 */

export interface ManifestEntry {
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly path: string;
  readonly dates: readonly string[];
  readonly tags: readonly string[];
  readonly source: { readonly vault: string; readonly path: string };
}

export interface Manifest {
  readonly publication: string;
  readonly destination: string;
  readonly entries: readonly ManifestEntry[];
}

/** `paths` maps each emitted entry's id to its output-dir-relative file path. */
export const buildManifest = (
  plan: PublicationPlan,
  paths: ReadonlyMap<string, string>,
): Manifest => ({
  publication: plan.publication.name,
  destination: plan.publication.destination.kind,
  entries: plan.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    route: entry.route,
    path: paths.get(entry.id) ?? '',
    dates: entry.dates,
    tags: entry.tags,
    source: { vault: entry.vault, path: entry.path },
  })),
});
