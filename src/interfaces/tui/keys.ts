import type { Key } from 'ink';
import { memberName, type Scope } from '../../domain/scope/scope.js';

/*
 * Key bindings shared by the screens (docs/architecture.md §6). Each screen owns its map;
 * these are the pieces that read the same everywhere.
 */

export const isDown = (input: string, key: Key): boolean => input === 'j' || key.downArrow;
export const isUp = (input: string, key: Key): boolean => input === 'k' || key.upArrow;
/** `b`, `Backspace` or `Esc` leave a pushed screen, restoring the one below as it was. */
export const isBack = (input: string, key: Key): boolean =>
  key.backspace || key.delete || key.escape || input === 'b';

export const scopeLabel = (scope: Scope): string =>
  scope.name ?? scope.members.map(memberName).join(' + ');
