import type { Destination } from '../destination.js';
import { modularTheme } from './astro-themes/modular.js';
import { createAstroDestination } from './astro.js';
import { htmlDestination } from './html.js';
import { markdownDestination } from './markdown.js';

/** The destination kinds every vault has without any plugin (astro over the built-in theme). */
export const builtinDestinations: readonly Destination[] = [
  markdownDestination,
  htmlDestination,
  createAstroDestination([modularTheme]),
];

export { markdownDestination, htmlDestination, createAstroDestination, modularTheme };
