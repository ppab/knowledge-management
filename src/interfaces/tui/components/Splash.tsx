import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../theme.js';

/*
 * The boot wordmark: the `ofl` logo mark — an open rounded square (the form) linked to a ring (the
 * link), drawn in box-drawing characters — with a highlight that sweeps across it, the `ofl` name
 * beside it, then a hand-off to the TUI. A terminal can't scale a font, so the mark is hand-drawn
 * here rather than pulled from a figlet dependency; the binary ships Node-free. The shimmer is
 * per-column lightness: a Gaussian band riding over a steady hue, so one bright vertical stripe
 * travels left to right across the mark. Colour is the whole effect, so with `NO_COLOR` (or no tty)
 * there is nothing to animate — `animate` is false, we paint the mark once in the accent colour and
 * leave at once. The runner owns the timeout and the skip; this only draws. It plays on every
 * launch, so it is kept short and is skippable with any key.
 */

/*
 * The logo mark: five rows, ten columns (trailing spaces included so the ring lights up as the
 * sweep reaches its columns). Columns, not characters, are what the shimmer sweeps.
 */
const MARK: readonly string[] = [
  '╭────╮    ',
  '│    │    ',
  '│   ╭────╮',
  '╰── │    │',
  '    ╰────╯',
];
const WIDTH = MARK[0]?.length ?? 0;

const NAME = 'ofl';
const URL = 'openform.link';

/** Cyan-ish, to sit beside the `accent` role without being the same flat cyan. */
const HUE = 184;
/** Half-width of the bright band, in columns: how far the highlight bleeds from its head. */
const SIGMA = 2.5;
/** Columns the head advances each frame; sized so one sweep lands near the default duration. */
const STEP = 1;
/** Resting and peak lightness of the band (0..1); the peak is near-white, the rest dim cyan. */
const BASE_L = 0.5;
const PEAK_L = 0.92;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** HSL→#rrggbb (s,l in 0..1), kept local so the splash pulls in no colour dependency. */
export const hsl = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * clamp01(c))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

/**
 * The colour of the cell in column `index` when the highlight's head is at `head` (a fractional
 * column). Lightness falls off as a Gaussian in the distance from the head, so one bright stripe
 * trails off smoothly to each side — the classic shimmer, with no hard edges to strobe.
 */
export const shimmerColor = (index: number, head: number): string => {
  const d = index - head;
  const band = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
  return hsl(HUE, 0.85, BASE_L + (PEAK_L - BASE_L) * band);
};

export interface SplashProps {
  readonly theme: Theme;
  /** False (NO_COLOR, no tty) paints the mark once, unanimated, and fires `onDone` straight away. */
  readonly animate: boolean;
  /** Called when the splash is finished (timeout) or the user pressed a key to skip it. */
  readonly onDone: () => void;
  /** Milliseconds between frames; the head advances `STEP` columns each. */
  readonly speed?: number;
  /** How long the whole splash lasts before it hands off, in milliseconds. */
  readonly duration?: number;
}

export const Splash = ({ theme, animate, onDone, speed = 45, duration = 750 }: SplashProps) => {
  const { exit } = useApp();
  // The head travels from just before the mark to just past it, then wraps, so the highlight
  // sweeps in from the left edge and off the right rather than popping in mid-mark.
  const [head, setHead] = useState(-2 * SIGMA);

  // `onDone` is called exactly once. A ref lets the one-shot effects below not depend on its
  // identity (which would re-arm the timers every render) while still calling the latest one.
  const done = useRef(onDone);
  done.current = onDone;
  const finish = useRef(false);
  const end = (): void => {
    if (finish.current) return;
    finish.current = true;
    done.current();
    exit();
  };

  // Any key skips the splash. Harmless when static: it just hands off a few hundred ms sooner.
  useInput(() => {
    end();
  });

  useEffect(() => {
    if (!animate) {
      end();
      return;
    }
    const span = WIDTH + 2 * SIGMA;
    const tick = setInterval(() => {
      // Wrap within the travel span so a long duration sweeps the mark more than once.
      setHead((h) => (h + STEP > span ? -2 * SIGMA : h + STEP));
    }, speed);
    const stop = setTimeout(end, duration);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
    // Runs once per splash: the timers own their lifetime and `end` is idempotent (the ref guard).
  }, [animate, speed, duration]);

  const accent = theme.paint('accent');
  const shimmering = animate && theme.colors;
  return (
    <Box paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        {MARK.map((row, r) => (
          // Row and column indices are stable identities here: the mark never reorders.
          <Text key={r}>
            {shimmering ? (
              Array.from(row).map((ch, c) => (
                // Spaces carry no glyph, so they need no colour — only the mark's strokes shimmer.
                <Text key={c} {...(ch === ' ' ? {} : { color: shimmerColor(c, head) })}>
                  {ch}
                </Text>
              ))
            ) : (
              <Text {...accent}>{row}</Text>
            )}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginLeft={4} justifyContent="center">
        <Text bold {...accent}>
          {NAME}
        </Text>
        <Text dimColor>{URL}</Text>
      </Box>
    </Box>
  );
};
