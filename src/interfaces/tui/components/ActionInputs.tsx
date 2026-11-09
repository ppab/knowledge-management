import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { PanelInput } from '../../../application/plugin/plugin.js';
import { useTui } from '../context.js';
import { clamp } from '../model.js';
import { Dialog } from './Dialog.js';

/*
 * The core-rendered input form for a panel action's `inputs` (docs/plans/courses.md, delivery D2):
 * one field at a time — text/number typed, an enum chosen with the arrows — collected into the
 * values the action receives as `context.inputs`. `Enter` advances, `Esc` cancels. A plugin never
 * draws this; it only declares the fields, so it stays free of Ink.
 */

const enumIndex = (field: PanelInput): number => {
  const values = field.values ?? [];
  const at = values.indexOf(String(field.default ?? ''));
  return at < 0 ? 0 : at;
};

const initialText = (field: PanelInput | undefined): string =>
  field === undefined || field.type === 'enum' ? '' : String(field.default ?? '');

export const ActionInputs = ({
  title,
  inputs,
  onSubmit,
  onCancel,
}: {
  readonly title: string;
  readonly inputs: readonly PanelInput[];
  readonly onSubmit: (values: Record<string, string | number>) => void;
  readonly onCancel: () => void;
}) => {
  const { theme } = useTui();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [text, setText] = useState(() => initialText(inputs[0]));
  const [choice, setChoice] = useState(() => (inputs[0] ? enumIndex(inputs[0]) : 0));
  const [error, setError] = useState<string | null>(null);

  const field = inputs[step];

  const advance = (value: string | number): void => {
    if (!field) return;
    const next = { ...values, [field.name]: value };
    if (step + 1 >= inputs.length) {
      onSubmit(next);
      return;
    }
    const upcoming = inputs[step + 1];
    setValues(next);
    setStep(step + 1);
    setText(initialText(upcoming));
    setChoice(upcoming ? enumIndex(upcoming) : 0);
    setError(null);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (!field) return;
    if (field.type === 'enum') {
      const options = field.values ?? [];
      if (key.return) {
        const picked = options[clamp(choice, options.length - 1)];
        if (picked !== undefined) advance(picked);
      } else if (key.downArrow || key.rightArrow)
        setChoice((c) => clamp(c + 1, options.length - 1));
      else if (key.upArrow || key.leftArrow) setChoice((c) => clamp(c - 1, options.length - 1));
      return;
    }
    if (key.return) {
      const trimmed = text.trim();
      if (trimmed === '' && field.required !== false) {
        setError(`${field.label} is required`);
        return;
      }
      if (field.type === 'number') {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) {
          setError(`${field.label} must be a number`);
          return;
        }
        advance(n);
      } else advance(trimmed);
    } else if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
    } else if (!key.ctrl && !key.meta && input !== '') {
      setText((t) => t + input);
    }
  });

  if (!field) return null;
  const options = field.values ?? [];
  return (
    <Dialog title={title}>
      <Box flexDirection="column">
        {inputs.slice(0, step).map((f) => (
          <Text key={f.name} dimColor>
            {f.label}: {String(values[f.name] ?? '')}
          </Text>
        ))}
        {field.type === 'enum' ? (
          <Box flexDirection="column">
            <Text bold {...theme.paint('accent')}>
              {field.label}
            </Text>
            {options.map((option, i) => (
              <Text
                key={option}
                {...(i === clamp(choice, options.length - 1) ? theme.paint('accent') : {})}
              >
                {i === clamp(choice, options.length - 1) ? '▸ ' : '  '}
                {option}
              </Text>
            ))}
          </Box>
        ) : (
          <Text>
            <Text bold {...theme.paint('accent')}>
              {field.label}
            </Text>{' '}
            {text}
            <Text inverse> </Text>
          </Text>
        )}
        {error !== null && <Text {...theme.paint('error')}>{error}</Text>}
      </Box>
    </Dialog>
  );
};
