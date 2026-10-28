import type { NotePlugin } from '../application/plugin/plugin.js';
import { goalsPlugin } from './goals/plugin.js';
import { todosPlugin } from './todos/plugin.js';

/**
 * The composition root for plugins: the only module that knows every first-party plugin.
 * Imported by the interfaces alone; the core never sees it (docs/plugins.md §1, rule 4).
 */
export const firstPartyPlugins: readonly NotePlugin[] = [todosPlugin, goalsPlugin];
