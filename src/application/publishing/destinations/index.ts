import type { Destination } from '../destination.js';
import { astroDestination } from './astro.js';
import { htmlDestination } from './html.js';
import { markdownDestination } from './markdown.js';

/** The destination kinds every vault has without any plugin. */
export const builtinDestinations: readonly Destination[] = [
  markdownDestination,
  htmlDestination,
  astroDestination,
];
