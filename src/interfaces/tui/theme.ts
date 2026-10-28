/*
 * The TUI's colours by role, so every screen paints the same thing the same way and a
 * terminal without colour (or a user with `NO_COLOR` set) gets the same text uncoloured.
 * Roles name intent, not hue; the palette is the only place that knows about hues.
 */

export type Role =
  | 'accent' // titles, keys in the hints, the cursor row
  | 'muted' // secondary columns: ids, vaults, dates
  | 'ok' // a status message that reports success
  | 'error' // a status message or inline text that reports failure
  | 'warn' // ambiguity
  | 'link' // a resolved reference or an external link
  | 'unavailable' // a reference into a vault that could not be opened
  | 'tag'
  | 'heading'
  | 'code';

const PALETTE: Readonly<Record<Role, string>> = {
  accent: 'cyan',
  muted: 'gray',
  ok: 'green',
  error: 'red',
  warn: 'yellow',
  link: 'cyan',
  unavailable: 'magenta',
  tag: 'magenta',
  heading: 'blue',
  code: 'green',
};

export interface Theme {
  /** `false` with `NO_COLOR` set: `paint` then adds nothing and the text renders plain. */
  readonly colors: boolean;
  /** Spread into a `<Text>`: `{ color }` for the role, or `{}` without colours. */
  paint(role: Role): { readonly color?: string };
}

export const createTheme = (env: Readonly<Record<string, string | undefined>> = {}): Theme => {
  const colors = (env.NO_COLOR ?? '') === '';
  return {
    colors,
    paint: (role) => (colors ? { color: PALETTE[role] } : {}),
  };
};
