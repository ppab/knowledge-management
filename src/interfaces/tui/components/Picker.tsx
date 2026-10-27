import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { listNotes } from '../../../application/notes/list-notes.js';
import { searchNotes } from '../../../application/search/search-notes.js';
import { ok } from '../../../domain/result.js';
import { useLoad, useTui } from '../context.js';
import { clamp } from '../model.js';
import { Rows } from './Rows.js';

/** A note the picker can hand back: always identified, since only ids can be referenced. */
export interface Picked {
  readonly id: string;
  readonly title: string;
  readonly vault: string;
}

/** Every word matches as a prefix while typing (`pip` finds `pipeline`); `*` is kept as is. */
export const pickerQuery = (typed: string): string =>
  typed
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => (word.endsWith('*') ? word : `${word}*`))
    .join(' ');

/**
 * Scope-wide note picker: type to search (vault rankings interleaved), arrows move, `Enter`
 * picks, `Esc` cancels. With nothing typed it lists every identified note of the scope.
 */
export const Picker = ({
  height,
  onPick,
  onCancel,
}: {
  readonly height: number;
  readonly onPick: (note: Picked) => void;
  readonly onCancel: () => void;
}) => {
  const { deps, scope, revision } = useTui();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const loaded = useLoad(async () => {
    const typed = query.trim();
    if (typed === '') {
      const all = await listNotes(deps, scope);
      if (!all.ok) return all;
      return ok(
        all.value.flatMap((e): Picked[] =>
          e.kind === 'note' ? [{ id: e.id, title: e.title, vault: e.vault }] : [],
        ),
      );
    }
    const hits = await searchNotes(deps, scope, pickerQuery(typed));
    if (!hits.ok) return hits;
    return ok(
      hits.value.flatMap((hit): Picked[] =>
        hit.entry.kind === 'note'
          ? [{ id: hit.entry.id, title: hit.entry.title, vault: hit.vault }]
          : [],
      ),
    );
  }, [query, revision]);
  const candidates = loaded.value ?? [];
  const at = clamp(cursor, candidates.length - 1);

  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return) {
      const picked = candidates[at];
      if (picked) onPick(picked);
    } else if (key.downArrow) setCursor(clamp(at + 1, candidates.length - 1));
    else if (key.upArrow) setCursor(clamp(at - 1, candidates.length - 1));
    else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
    } else if (!key.ctrl && !key.meta && !key.tab && input !== '') {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>find:</Text> {query}
        <Text inverse> </Text>
      </Text>
      <Rows
        header={['title', 'vault', 'id']}
        rows={candidates.map((c) => [c.title, c.vault, c.id])}
        cursor={at}
        height={height - 1}
        empty={loaded.state === 'loading' ? 'searching…' : 'No matching notes.'}
      />
    </Box>
  );
};
