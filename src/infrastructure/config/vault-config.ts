import { z } from 'zod';
import { validation, type AppError } from '../../domain/errors.js';
import { validateIdentityConfig } from '../../domain/identity/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import { asVaultId, type VaultConfig } from '../../domain/vault/vault.js';

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
});

export type VaultConfigFile = z.input<typeof schema>;

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
  const { vault, notes, editor } = parsed.data;
  return ok({
    id: asVaultId(vault.id),
    name: vault.name,
    include: notes.include,
    exclude: notes.exclude,
    identity: parsed.data.identity,
    ...(editor !== undefined && { editor }),
  });
};

export const toVaultConfigFile = (config: VaultConfig): VaultConfigFile => ({
  vault: { id: config.id, name: config.name },
  notes: { include: [...config.include], exclude: [...config.exclude] },
  identity: config.identity,
  ...(config.editor !== undefined && { editor: config.editor }),
});
