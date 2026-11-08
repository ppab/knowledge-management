import { z } from 'zod';
import { validation, type AppError } from '../../domain/errors.js';
import { validateIdentityConfig } from '../../domain/identity/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import { asVaultId, type VaultConfig } from '../../domain/vault/vault.js';
import {
  DEFAULT_ROUTE,
  REFERENCE_POLICIES,
  type DestinationRef,
  type Publication,
  type ReferencePolicy,
} from '../../domain/publishing/publication.js';

/**
 * A destination is either a bare kind (`destination: markdown`) or a kind plus arbitrary options
 * the destination itself validates (`destination: { kind: astro, theme: modular }`). Unknown
 * keys are kept — they are the options.
 */
const destinationSchema = z.union([
  z.string().min(1),
  z.looseObject({ kind: z.string().min(1) }),
]);

const publicationSchema = z.object({
  destination: destinationSchema,
  output: z.string().min(1),
  route: z.string().min(1).default(DEFAULT_ROUTE),
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
  vaults: z.array(z.string().min(1)).min(1).optional(),
  references: z
    .string()
    .default('fail')
    .refine((value): value is ReferencePolicy => (REFERENCE_POLICIES as readonly string[]).includes(value), {
      message: `references must be one of: ${REFERENCE_POLICIES.join(', ')}`,
    }),
});

/** On-disk shape of `.notes/config.yaml`. */
const schema = z.object({
  vault: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  notes: z
    .object({
      include: z.array(z.string().min(1)).min(1).default(['**/*.md']),
      exclude: z.array(z.string().min(1)).default([]),
    })
    .default({ include: ['**/*.md'], exclude: [] }),
  identity: z
    .discriminatedUnion('strategy', [
      z.object({ strategy: z.literal('ulid') }),
      z.object({ strategy: z.literal('uuidv7') }),
      z.object({ strategy: z.literal('formatted'), format: z.string().min(1) }),
    ])
    .default({ strategy: 'ulid' }),
  editor: z.string().min(1).optional(),
  // `todos:` with nothing after it parses as null; it means "enabled, default settings".
  plugins: z.record(z.string().min(1), z.unknown()).optional(),
  publications: z.record(z.string().min(1), publicationSchema).optional(),
});

export type VaultConfigFile = z.input<typeof schema>;

/** Splits a parsed destination into `{ kind, options }`; the string form carries no options. */
const toDestinationRef = (raw: z.output<typeof destinationSchema>): DestinationRef => {
  if (typeof raw === 'string') return { kind: raw, options: {} };
  const { kind, ...options } = raw;
  return { kind, options };
};

/** Serializes a destination back to its config shape: a bare string when it has no options. */
const fromDestinationRef = (
  destination: DestinationRef,
): string | { kind: string; [key: string]: unknown } => {
  const options = (destination.options ?? {}) as Record<string, unknown>;
  return Object.keys(options).length === 0
    ? destination.kind
    : { kind: destination.kind, ...options };
};

export const parseVaultConfig = (data: unknown): Result<VaultConfig, AppError> => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return err(
      validation('Invalid vault configuration', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
    );
  }
  const identity = validateIdentityConfig(parsed.data.identity);
  if (!identity.ok) return identity;
  const { vault, notes, editor, plugins, publications } = parsed.data;
  return ok({
    id: asVaultId(vault.id),
    name: vault.name,
    include: notes.include,
    exclude: notes.exclude,
    identity: parsed.data.identity,
    ...(editor !== undefined && { editor }),
    ...(plugins !== undefined && {
      plugins: Object.fromEntries(
        Object.entries(plugins).map(([name, settings]) => [name, settings ?? {}]),
      ),
    }),
    ...(publications !== undefined && {
      publications: Object.fromEntries(
        Object.entries(publications).map(([name, pub]): [string, Publication] => [
          name,
          {
            name,
            destination: toDestinationRef(pub.destination),
            output: pub.output,
            route: pub.route,
            include: pub.include,
            exclude: pub.exclude,
            references: pub.references,
            ...(pub.vaults !== undefined && { vaults: pub.vaults }),
          },
        ]),
      ),
    }),
  });
};

export const toVaultConfigFile = (config: VaultConfig): VaultConfigFile => ({
  vault: { id: config.id, name: config.name },
  notes: { include: [...config.include], exclude: [...config.exclude] },
  identity: config.identity,
  ...(config.editor !== undefined && { editor: config.editor }),
  ...(config.plugins !== undefined && { plugins: { ...config.plugins } }),
  ...(config.publications !== undefined && {
    publications: Object.fromEntries(
      Object.entries(config.publications).map(([name, pub]) => [
        name,
        {
          destination: fromDestinationRef(pub.destination),
          output: pub.output,
          route: pub.route,
          include: [...pub.include],
          exclude: [...pub.exclude],
          references: pub.references,
          ...(pub.vaults !== undefined && { vaults: [...pub.vaults] }),
        },
      ]),
    ),
  }),
});
