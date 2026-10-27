import { useApp, useWindowSize } from 'ink';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { AppError } from '../../domain/errors.js';
import { TuiContext, type ChangeFeed, type StatusMessage, type TuiServices } from './context.js';
import { initialStack, navigate as reduce, type Navigation, type Screen } from './model.js';
import { Calendar } from './screens/Calendar.js';
import { Day } from './screens/DayScreen.js';
import { DiffView } from './screens/DiffView.js';
import { History } from './screens/History.js';
import { NoteList } from './screens/NoteList.js';
import { NoteView } from './screens/NoteView.js';
import { PanelScreen } from './screens/PanelScreen.js';
import { RevisionView } from './screens/RevisionView.js';

export interface AppProps {
  readonly services: TuiServices;
  readonly changes: ChangeFeed;
  readonly initial?: readonly Screen[];
}

const Top = ({ screen }: { readonly screen: Screen }) => {
  switch (screen.kind) {
    case 'list':
      return <NoteList screen={screen} />;
    case 'note':
      return <NoteView screen={screen} />;
    case 'calendar':
      return <Calendar screen={screen} />;
    case 'day':
      return <Day screen={screen} />;
    case 'panel':
      return <PanelScreen screen={screen} />;
    case 'history':
      return <History screen={screen} />;
    case 'revision':
      return <RevisionView screen={screen} />;
    case 'diff':
      return <DiffView screen={screen} />;
  }
};

/** The shell: screen stack, watcher-driven revision, status line, terminal size. */
export const App = ({ services, changes, initial }: AppProps) => {
  const [stack, dispatch] = useReducer(reduce, initial ? [...initial] : initialStack());
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const { exit } = useApp();
  const { rows, columns } = useWindowSize();

  useEffect(
    () =>
      changes.subscribe(() => {
        setRevision((r) => r + 1);
      }),
    [changes],
  );

  const notify = useCallback((text: string, level: 'info' | 'error' = 'info') => {
    setStatus({ text, level });
  }, []);
  const report = useCallback((error: AppError) => {
    setStatus({ text: `${error.code.toLowerCase()}: ${error.message}`, level: 'error' });
  }, []);
  const navigate = useCallback((action: Navigation) => {
    setStatus(null);
    dispatch(action);
  }, []);
  const quit = useCallback(() => {
    exit();
  }, [exit]);

  const state = useMemo(
    () => ({ ...services, revision, rows, columns, status, notify, report, navigate, quit }),
    [services, revision, rows, columns, status, notify, report, navigate, quit],
  );
  const top: Screen = stack[stack.length - 1] ?? { kind: 'list', cursor: 0 };
  return (
    <TuiContext.Provider value={state}>
      <Top screen={top} />
    </TuiContext.Provider>
  );
};
