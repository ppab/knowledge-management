import { ulid } from 'ulid';
import { v7 as uuidv7 } from 'uuid';
import type { UniqueSource } from '../../domain/identity/identity.js';

export const createUniqueSource = (): UniqueSource => ({
  ulid: () => ulid(),
  uuidv7: () => uuidv7(),
});
