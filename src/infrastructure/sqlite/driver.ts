/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- callers name row shapes */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/*
 * The only module that touches a SQLite binding. It is deliberately tiny so a `bun:sqlite`
 * implementation can replace it one-for-one for a compiled binary (see docs/decisions/0001).
 * The caller names the row shape of each query; this is the one place a cast is accepted.
 */

export type SqlValue = SQLInputValue;

export interface SqliteStatement {
  run(...params: SqlValue[]): { changes: number; lastInsertRowid: number };
  get<T>(...params: SqlValue[]): T | undefined;
  all<T>(...params: SqlValue[]): T[];
}

export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/** Opens (creating if needed) the database at `file`; `':memory:'` for a private in-memory one. */
export const openSqlite = (file: string): SqliteDriver => {
  const db = new DatabaseSync(file);
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params) => {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
        get: <T>(...params: SqlValue[]) => statement.get(...params) as T | undefined,
        all: <T>(...params: SqlValue[]) => statement.all(...params) as T[],
      };
    },
    close: () => {
      db.close();
    },
  };
};
