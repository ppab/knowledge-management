/**
 * Every expected failure in the system is one of these. Interfaces map `code` to exit codes
 * (CLI) or messages (TUI); `details` carries structured context for `--json` consumers.
 */
export type ErrorCode =
  'NOT_FOUND' | 'AMBIGUOUS' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE' | 'USAGE' | 'INTERNAL';

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const appError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError => (details ? { code, message, details } : { code, message });

export const notFound = (message: string, details?: Record<string, unknown>): AppError =>
  appError('NOT_FOUND', message, details);
export const ambiguous = (message: string, details?: Record<string, unknown>): AppError =>
  appError('AMBIGUOUS', message, details);
export const conflict = (message: string, details?: Record<string, unknown>): AppError =>
  appError('CONFLICT', message, details);
export const validation = (message: string, details?: Record<string, unknown>): AppError =>
  appError('VALIDATION', message, details);
export const unavailable = (message: string, details?: Record<string, unknown>): AppError =>
  appError('UNAVAILABLE', message, details);
export const usage = (message: string, details?: Record<string, unknown>): AppError =>
  appError('USAGE', message, details);
