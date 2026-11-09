import { describe, expect, it, vi } from 'vitest';
import { Splash, hsl, shimmerColor } from '../../src/interfaces/tui/components/Splash.js';
import { createTheme } from '../../src/interfaces/tui/theme.js';
import { renderTerminal } from './harness.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('splash colour', () => {
  it('maps HSL to a six-digit hex channel triple', () => {
    expect(hsl(0, 1, 0.5)).toBe('#ff0000');
    expect(hsl(184, 0, 0)).toBe('#000000');
    expect(hsl(184, 1, 1)).toBe('#ffffff');
  });

  it('peaks at the highlight head and dims with distance from it', () => {
    const atHead = hsl(184, 0.85, 0.92);
    expect(shimmerColor(2, 2)).toBe(atHead);
    // A glyph far from the head sits near the resting lightness, nowhere near the peak.
    expect(shimmerColor(0, 5)).not.toBe(atHead);
    const near = Number.parseInt(shimmerColor(2, 2.5).slice(1, 3), 16);
    const far = Number.parseInt(shimmerColor(2, 6).slice(1, 3), 16);
    expect(near).toBeGreaterThan(far);
  });
});

describe('splash', () => {
  it('shows the logo mark, name and url while it plays', async () => {
    const term = renderTerminal(
      <Splash theme={createTheme({})} animate={true} onDone={() => undefined} duration={4000} />,
      { interactive: true },
    );
    const frame = await term.waitFor('openform.link');
    expect(frame).toContain('╭'); // the box-drawing logo mark
    expect(frame).toContain('ofl'); // the wordmark beside it
    term.unmount();
  });

  it('fires onDone at once when not animating', () => {
    const onDone = vi.fn();
    renderTerminal(<Splash theme={createTheme({})} animate={false} onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('animates then hands off once after its duration, calling onDone a single time', async () => {
    const onDone = vi.fn();
    renderTerminal(
      <Splash theme={createTheme({})} animate={true} onDone={onDone} speed={10} duration={40} />,
      { interactive: true },
    );
    expect(onDone).not.toHaveBeenCalled();
    await sleep(120);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
