import { Box, Text, useInput } from 'ink';
import { Spinner, StatusMessage, TextInput } from '@inkjs/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createNote,
  previewTemplates,
  type TemplatePreview,
} from '../../../application/notes/create-note.js';
import { resolveWriteTarget } from '../../../domain/scope/scope.js';
import { Dialog, DIALOG_CHROME } from '../components/Dialog.js';
import type { Hint } from '../components/Frame.js';
import { useBodyHeight } from '../components/Frame.js';
import { InkUi } from '../components/ink-ui.js';
import { Rows } from '../components/Rows.js';
import { useTui } from '../context.js';
import { isDown, isUp } from '../keys.js';
import { clamp, noteScreen } from '../model.js';

/*
 * The note-creation flow (issue #4): `c` → title → template → create, as one owned state machine.
 *
 * Why a self-contained flow rather than loose state on `NoteList`: the keyboard must have a single
 * owner from the first keystroke to the last, including the async gaps where templates are
 * previewed and the note is written. `NoteList` turns its list keys and the leader off whenever
 * `active` is true, so nothing else reads the keyboard mid-flow. Each async step is guarded by a
 * liveness flag, so a preview or write that resolves after the user cancelled (or the app
 * unmounted) is dropped instead of reopening a closed dialog.
 */

type Stage =
  // Editing the title. `prefill` seeds the input (restored on retry); `nonce` remounts it.
  | {
      readonly kind: 'title';
      readonly nonce: number;
      readonly prefill: string;
      readonly hint?: string;
    }
  // Previewing the target vault's templates for the title.
  | { readonly kind: 'loading'; readonly nonce: number; readonly title: string }
  // Choosing a template; `error` shows a failed write while keeping the selection to retry.
  | {
      readonly kind: 'select';
      readonly title: string;
      readonly templates: readonly TemplatePreview[];
      readonly cursor: number;
      readonly error?: string;
    }
  // Writing the note. No key cancels it; the dialog shows it is pending.
  | {
      readonly kind: 'creating';
      readonly nonce: number;
      readonly title: string;
      readonly template: string | undefined;
      readonly templates: readonly TemplatePreview[];
      readonly cursor: number;
    };

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface CreateFlow {
  /** True from `start()` until the note opens or the user cancels. */
  readonly active: boolean;
  /** Frame title for the current stage. */
  readonly title: string;
  /** Frame hints for the current stage. */
  readonly hints: readonly Hint[];
  /** The dialog to draw in the body while active (`null` otherwise). */
  readonly view: ReactNode;
  /** Begins the flow at the title prompt. */
  start(): void;
}

export const useCreateFlow = (): CreateFlow => {
  const { deps, scope, registry, cwd, notify, navigate, theme } = useTui();
  const [stage, setStage] = useState<Stage | null>(null);
  const height = useBodyHeight();
  const seq = useRef(0);
  const nextNonce = () => (seq.current += 1);

  const cancel = () => {
    setStage(null);
  };
  const toTitle = (prefill: string, hint?: string) => {
    setStage({ kind: 'title', nonce: nextNonce(), prefill, ...(hint !== undefined && { hint }) });
  };

  const submitTitle = (value: string) => {
    const title = value.trim();
    if (title === '') {
      setStage((s) => (s?.kind === 'title' ? { ...s, hint: 'Title must not be empty' } : s));
      return;
    }
    setStage({ kind: 'loading', nonce: nextNonce(), title });
  };

  // The preview for a title as the stage it produces: the selector, or the title prompt again
  // carrying the failure. Pure, so the effect below only has to wire up liveness.
  const previewStage = async (title: string): Promise<Stage> => {
    const target = resolveWriteTarget(scope, { cwd });
    if (!target.ok)
      return { kind: 'title', nonce: nextNonce(), prefill: title, hint: target.error.message };
    const templates = await previewTemplates(deps, target.value, title, registry.templates());
    return { kind: 'select', title, templates, cursor: 0 };
  };

  // Run it once per entry into `loading`; a result that resolves after the stage moved on
  // (cancel, unmount, or a newer attempt) is dropped by the liveness flag.
  const loadingNonce = stage?.kind === 'loading' ? stage.nonce : null;
  useEffect(() => {
    if (stage?.kind !== 'loading') return;
    const { title } = stage;
    let live = true;
    void previewStage(title).then(
      (next) => {
        if (live) setStage(next);
      },
      (error: unknown) => {
        if (live) toTitle(title, asMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, [loadingNonce]);

  // Write the note once per entry into `creating`; on success open it, on failure return to the
  // selector with the error and the selection intact. A late result is dropped as above.
  const creatingNonce = stage?.kind === 'creating' ? stage.nonce : null;
  useEffect(() => {
    if (stage?.kind !== 'creating') return;
    const { title, template, templates, cursor } = stage;
    const toSelect = (error: string): Stage => ({
      kind: 'select',
      title,
      templates,
      cursor,
      error,
    });
    let live = true;
    const write = async () => {
      const target = resolveWriteTarget(scope, { cwd });
      if (!target.ok) return target;
      return createNote(
        deps,
        target.value,
        { title, ...(template !== undefined && { template }) },
        registry.templates(),
      );
    };
    void write().then(
      (created) => {
        if (!live) return;
        if (!created.ok) {
          setStage(toSelect(created.error.message));
          return;
        }
        setStage(null);
        notify(`Created ${created.value.id} at ${created.value.path}`);
        navigate({ type: 'push', screen: noteScreen({ query: created.value.id }) });
      },
      (error: unknown) => {
        if (live) setStage(toSelect(asMessage(error)));
      },
    );
    return () => {
      live = false;
    };
  }, [creatingNonce]);

  // Esc leaves the title prompt (the TextInput itself ignores Esc and owns typing + Enter).
  useInput(
    (_input, key) => {
      if (key.escape) cancel();
    },
    { isActive: stage?.kind === 'title' },
  );
  // Esc cancels while previewing; a late preview is already guarded.
  useInput(
    (_input, key) => {
      if (key.escape) cancel();
    },
    { isActive: stage?.kind === 'loading' },
  );
  // Selecting a template: move the cursor, Enter writes, Esc cancels.
  useInput(
    (input, key) => {
      if (stage?.kind !== 'select') return;
      const last = stage.templates.length - 1;
      if (key.escape) cancel();
      else if (isDown(input, key)) setStage({ ...stage, cursor: clamp(stage.cursor + 1, last) });
      else if (isUp(input, key)) setStage({ ...stage, cursor: clamp(stage.cursor - 1, last) });
      else if (key.return)
        setStage({
          kind: 'creating',
          nonce: nextNonce(),
          title: stage.title,
          template: stage.templates[stage.cursor]?.name,
          templates: stage.templates,
          cursor: stage.cursor,
        });
    },
    { isActive: stage?.kind === 'select' },
  );
  // While writing, the keyboard is owned but idle: repeated Enter and Esc do nothing.
  useInput(() => undefined, { isActive: stage?.kind === 'creating' });

  const title =
    stage === null
      ? ''
      : stage.kind === 'title'
        ? 'new note'
        : stage.kind === 'loading'
          ? 'new note · loading templates'
          : stage.kind === 'select'
            ? `new note "${stage.title}" · choose a template`
            : `new note "${stage.title}" · creating`;

  const hints: readonly Hint[] =
    stage === null
      ? []
      : stage.kind === 'title'
        ? [
            ['Enter', 'create'],
            ['Esc', 'cancel'],
          ]
        : stage.kind === 'loading'
          ? [['Esc', 'cancel']]
          : stage.kind === 'select'
            ? [
                ['j/k', 'move'],
                ['Enter', 'create'],
                ['Esc', 'cancel'],
              ]
            : [['', 'creating… please wait']];

  const view: ReactNode =
    stage === null ? null : (
      <InkUi>
        {stage.kind === 'title' ? (
          <Dialog width={60}>
            <Box>
              <Text bold {...theme.paint('accent')}>
                title:{' '}
              </Text>
              <TextInput key={stage.nonce} defaultValue={stage.prefill} onSubmit={submitTitle} />
            </Box>
            {stage.hint !== undefined && (
              <StatusMessage variant="error">{stage.hint}</StatusMessage>
            )}
          </Dialog>
        ) : stage.kind === 'loading' ? (
          <Dialog width={60}>
            <Spinner label={`Loading templates for "${stage.title}"…`} />
          </Dialog>
        ) : stage.kind === 'select' ? (
          <Dialog>
            {stage.error !== undefined && (
              <StatusMessage variant="error">{stage.error}</StatusMessage>
            )}
            <Rows
              header={['template', 'path']}
              rows={stage.templates.map((t) => [t.name, t.path])}
              roles={[null, 'muted']}
              cursor={stage.cursor}
              height={height - DIALOG_CHROME - (stage.error !== undefined ? 1 : 0)}
              empty="No templates"
            />
          </Dialog>
        ) : (
          <Dialog width={60}>
            <Spinner label={`Creating "${stage.title}"…`} />
          </Dialog>
        )}
      </InkUi>
    );

  return {
    active: stage !== null,
    title,
    hints,
    view,
    start: () => {
      setStage({ kind: 'title', nonce: nextNonce(), prefill: '' });
    },
  };
};
