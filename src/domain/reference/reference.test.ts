import { describe, expect, it } from 'vitest';
import { unwrap } from '../result.js';
import { parseNoteId } from '../note/note-id.js';
import { findReferences, formatReference } from './reference.js';

describe('reference grammar', () => {
  it('parses plain and labelled references with exact ranges', () => {
    const text = 'see [[A1]] and [[B2|Some label]].';
    expect(findReferences(text, 100)).toEqual([
      { target: 'A1', range: { start: 104, end: 110 } },
      { target: 'B2', label: 'Some label', range: { start: 115, end: 132 } },
    ]);
  });

  it('rejects ids with whitespace or empty ids; a pipe inside the label is label text', () => {
    expect(findReferences('[[a b]] [[a|b|c]] [[]] [[x]]]')).toEqual([
      { target: 'a', label: 'b|c', range: { start: 8, end: 17 } },
      { target: 'x', range: { start: 23, end: 28 } },
    ]);
  });

  it('keeps an empty label distinct from no label', () => {
    expect(findReferences('[[a|]]')[0]).toMatchObject({ target: 'a', label: '' });
  });

  it('formats canonical references', () => {
    const id = unwrap(parseNoteId('N1'));
    expect(formatReference(id)).toBe('[[N1]]');
    expect(formatReference(id, 'Label')).toBe('[[N1|Label]]');
    expect(formatReference(id, '')).toBe('[[N1]]');
  });
});
