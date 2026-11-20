import { Text, useInput } from 'ink';
import { useState } from 'react';
import { listTags } from '../../../application/entries/list-tags.js';
import { useLoad, useTui } from '../context.js';
import { clamp } from '../model.js';
import { Dialog, DIALOG_CHROME } from './Dialog.js';
import { Rows } from './Rows.js';

/*
 * The `t` tag editor: a multi-select over every tag in the scope, the note's current tags
 * pre-checked. Arrows move, Space toggles the focused tag, typing filters the list, and a typed
 * name that matches nothing offers a `+ create` row so a brand-new tag can be added without
 * leaving the picker. Enter saves the whole set; Esc cancels. Letters go to the filter, so
 * navigation is on the arrows (not `j/k`), exactly like the note `Picker`.
 */

interface Row {
  readonly create: boolean;
  readonly tag: string;
}

export const TagPicker = ({
  current,
  height,
  onSubmit,
  onCancel,
}: {
  readonly current: readonly string[];
  readonly height: number;
  readonly onSubmit: (tags: readonly string[]) => void;
  readonly onCancel: () => void;
}) => {
  const { deps, scope, revision, theme } = useTui();
  const [selected, setSelected] = useState<readonly string[]>([...current]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const loaded = useLoad(() => listTags(deps, scope), [revision]);
  const all = loaded.value ?? [];
  // A tag selected this session (e.g. just created) may not be on any note yet; show it anyway.
  const universe = [...new Set([...all, ...selected])].sort((a, b) => a.localeCompare(b));
  const typed = query.trim().replace(/^#+/, '');
  const needle = typed.toLowerCase();
  const matches = universe.filter((tag) => tag.toLowerCase().includes(needle));
  const canCreate = typed !== '' && !universe.some((tag) => tag === typed);
  const rows: Row[] = [
    ...(canCreate ? [{ create: true, tag: typed }] : []),
    ...matches.map((tag): Row => ({ create: false, tag })),
  ];
  const at = clamp(cursor, rows.length - 1);

  const toggle = (tag: string) => {
    setSelected((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));
  };

  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) onSubmit(selected);
    else if (key.downArrow) setCursor(clamp(at + 1, rows.length - 1));
    else if (key.upArrow) setCursor(clamp(at - 1, rows.length - 1));
    else if (input === ' ') {
      const row = rows[at];
      if (!row) return;
      toggle(row.tag);
      if (row.create) {
        setQuery('');
        setCursor(0);
      }
    } else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
    } else if (!key.ctrl && !key.meta && !key.tab && input !== '') {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  const label = (row: Row): string =>
    row.create
      ? `+ create "${row.tag}"`
      : `${selected.includes(row.tag) ? '[x]' : '[ ]'} ${row.tag}`;

  return (
    <Dialog>
      <Text>
        <Text bold {...theme.paint('accent')}>
          tags:
        </Text>{' '}
        {query}
        <Text inverse> </Text>
        <Text {...theme.paint('muted')}> · {String(selected.length)} selected</Text>
      </Text>
      <Rows
        rows={rows.map((row) => [label(row)])}
        cursor={at}
        height={height - 1 - DIALOG_CHROME}
        empty={loaded.state === 'loading' ? 'loading…' : 'No tags yet — type to create one.'}
      />
    </Dialog>
  );
};
