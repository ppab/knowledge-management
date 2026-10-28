/*
 * Bridges @inkjs/ui's component theme to the project's role palette, so its widgets draw from the
 * one source of truth and fall silent under `NO_COLOR` exactly as the rest of the TUI does.
 * @inkjs/ui colours its Spinner frame and StatusMessage icon from its own hardcoded hues via a
 * theme context; we override just those, mapping each to a `Role` the project already owns. The
 * icons still carry meaning when colour is off, so a `NO_COLOR` terminal stays legible.
 */
import { ThemeProvider, defaultTheme, extendTheme, type Theme as InkUiTheme } from '@inkjs/ui';
import type { ReactNode } from 'react';
import { useTui } from '../context.js';
import type { Role, Theme } from '../theme.js';

/** @inkjs/ui status variants → the project's roles. `info` borrows `accent` (the project's cyan). */
const STATUS_ROLE: Readonly<Record<string, Role>> = {
  success: 'ok',
  error: 'error',
  warning: 'warn',
  info: 'accent',
};

/** A @inkjs/ui theme whose only hues come from `theme`; `paint` yields `{}` with colour off. */
export const inkUiTheme = (theme: Theme): InkUiTheme =>
  extendTheme(defaultTheme, {
    components: {
      Spinner: { styles: { frame: () => ({ ...theme.paint('accent') }) } },
      StatusMessage: {
        styles: {
          icon: (props?: { readonly variant?: string }) => ({
            ...theme.paint(STATUS_ROLE[props?.variant ?? 'info'] ?? 'accent'),
          }),
        },
      },
    },
  });

/** Wraps @inkjs/ui widgets so they paint from the project theme carried in context. */
export const InkUi = ({ children }: { readonly children: ReactNode }) => {
  const { theme } = useTui();
  return <ThemeProvider theme={inkUiTheme(theme)}>{children}</ThemeProvider>;
};
