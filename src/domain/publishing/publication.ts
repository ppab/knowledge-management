/*
 * A publication is a named, declarative recipe for emitting a portable copy of a selected set of
 * entries: which notes (selection), where each one lands (route + output), how unresolved and
 * excluded references are handled (policy), and which destination renders them. The destination's
 * code lives in the application layer; the domain only carries the reference to it.
 */

/** How a reference whose target is not itself published is handled. One policy covers both the
 * excluded (target is a note, just not selected) and unresolved (no such note) cases. */
export type ReferencePolicy = 'fail' | 'strip-to-label' | 'keep-id';

export const REFERENCE_POLICIES: readonly ReferencePolicy[] = ['fail', 'strip-to-label', 'keep-id'];

/** Names a destination kind and carries its opaque, destination-validated options. */
export interface DestinationRef {
  readonly kind: string;
  readonly options: unknown;
}

export interface Publication {
  readonly name: string;
  readonly destination: DestinationRef;
  /** Output directory, relative to the defining vault's root or absolute. */
  readonly output: string;
  /** Route template over `{{slug}}` / `{{id}}` / `{{type}}` / `{{dir}}` / `{{stem}}`. */
  readonly route: string;
  /** Vault-relative globs; `[]` means every eligible note. */
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Vault names to draw notes from; absent = only the defining vault. */
  readonly vaults?: readonly string[];
  readonly references: ReferencePolicy;
}

/** The route template a publication gets when its config omits one. */
export const DEFAULT_ROUTE = '/{{slug}}/';
