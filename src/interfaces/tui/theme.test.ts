import { describe, expect, it } from 'vitest';
import { createTheme } from './theme.js';

describe('createTheme', () => {
  it('paints roles with the palette by default', () => {
    const theme = createTheme({});
    expect(theme.colors).toBe(true);
    expect(theme.paint('accent')).toEqual({ color: 'cyan' });
    expect(theme.paint('error')).toEqual({ color: 'red' });
  });

  it('paints nothing when NO_COLOR is set to anything non-empty', () => {
    const theme = createTheme({ NO_COLOR: '1' });
    expect(theme.colors).toBe(false);
    expect(theme.paint('accent')).toEqual({});
    expect(createTheme({ NO_COLOR: '' }).colors).toBe(true);
  });
});
