import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { generateNoteId, validateIdentityFormat } from './identity.js';

const unique = { ulid: () => '01ULID', uuidv7: () => '0199-uuid' };
const context = { vault: 'monitor', type: 'ADR', date: new Date(2026, 9, 23) };

describe('identity strategies', () => {
  it('delegates ulid and uuidv7 to the unique source', () => {
    expect(unwrap(generateNoteId({ strategy: 'ulid' }, context, unique))).toBe('01ULID');
    expect(unwrap(generateNoteId({ strategy: 'uuidv7' }, context, unique))).toBe('0199-uuid');
  });

  it('composes formatted ids from context and a unique component', () => {
    const id = generateNoteId(
      { strategy: 'formatted', format: '{vault}-{type}-{date}-{ulid}' },
      context,
      unique,
    );
    expect(unwrap(id)).toBe('monitor-ADR-20261023-01ULID');
  });

  it('rejects formats without a unique component or with unknown variables', () => {
    expect(validateIdentityFormat('{vault}-{date}').ok).toBe(false);
    expect(validateIdentityFormat('{team}-{ulid}').ok).toBe(false);
    expect(validateIdentityFormat('{ulid}').ok).toBe(true);
  });

  it('fails when {type} is requested but the context has none', () => {
    const noType = { vault: context.vault, date: context.date };
    const id = generateNoteId({ strategy: 'formatted', format: '{type}-{ulid}' }, noType, unique);
    expect(id.ok).toBe(false);
  });

  it('sanitizes context values that would break reference syntax', () => {
    const id = generateNoteId(
      { strategy: 'formatted', format: '{vault}-{ulid}' },
      { ...context, vault: 'my vault|x' },
      unique,
    );
    expect(unwrap(id)).toBe('my-vault-x-01ULID');
  });
});
