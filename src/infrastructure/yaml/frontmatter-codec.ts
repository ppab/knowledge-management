import { Document, isMap, parseDocument, visit } from 'yaml';
import { validation, type AppError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { FrontmatterCodec, FrontmatterUpdate } from '../../application/ports.js';

/** `lineWidth: 0` disables folding so long strings are never rewrapped on write. */
const STRINGIFY = { lineWidth: 0, flowCollectionPadding: false } as const;

const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : text + '\n';

const load = (yaml: string): Result<Document, AppError> => {
  const doc = parseDocument(yaml, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    return err(validation(`Invalid YAML: ${doc.errors.map((e) => e.message.trim()).join('; ')}`));
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    return err(validation('Frontmatter must be a YAML mapping'));
  }
  return ok(doc);
};

/**
 * Adding keys that do not exist yet is the common case (`adopt`, `create`). Appending their
 * serialization to the original text keeps every existing byte intact, which a full
 * re-serialization cannot promise (the library normalizes flow-collection spacing, for one).
 */
const appendOnly = (doc: Document, update: FrontmatterUpdate): Record<string, unknown> | null => {
  if (update.mapStrings !== undefined || (update.remove ?? []).length > 0) return null;
  if (doc.contents !== null && !(isMap(doc.contents) && !doc.contents.flow)) return null;
  const additions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update.setIfMissing ?? {})) {
    if (!doc.has(key)) additions[key] = value;
  }
  for (const [key, value] of Object.entries(update.set ?? {})) {
    if (doc.has(key)) return null;
    additions[key] = value;
  }
  return additions;
};

export const createFrontmatterCodec = (): FrontmatterCodec => ({
  parse(yaml) {
    const doc = load(yaml);
    if (!doc.ok) return doc;
    const value: unknown = doc.value.toJS();
    if (value === null || value === undefined) return ok({});
    return ok(value as Record<string, unknown>);
  },

  update(yaml, update) {
    const loaded = load(yaml);
    if (!loaded.ok) return loaded;
    const doc = loaded.value;

    const additions = appendOnly(doc, update);
    if (additions !== null) {
      if (Object.keys(additions).length === 0) return ok(withNewline(yaml));
      return ok(withNewline(yaml) + new Document(additions).toString(STRINGIFY));
    }

    doc.contents ??= doc.createNode({});
    if (update.mapStrings) {
      const map = update.mapStrings;
      visit(doc, {
        Scalar(_key, node) {
          if (typeof node.value === 'string') node.value = map(node.value);
        },
      });
    }
    for (const key of update.remove ?? []) doc.delete(key);
    for (const [key, value] of Object.entries(update.set ?? {})) doc.set(key, value);
    for (const [key, value] of Object.entries(update.setIfMissing ?? {})) {
      if (!doc.has(key)) doc.set(key, value);
    }
    // A mapping whose only key was removed serializes as `{}`; prefer empty text.
    if (isMap(doc.contents) && doc.contents.items.length === 0) return ok('');
    return ok(withNewline(doc.toString(STRINGIFY)));
  },
});
