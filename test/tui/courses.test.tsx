import { afterEach, describe, expect, it } from 'vitest';
import { coursesPlugin } from '../../src/plugins/courses/plugin.js';
import { harness, KEYS, type Terminal } from './harness.js';

const fm = (lines: string[]): string => `---\n${lines.join('\n')}\n---\n`;
const files: Record<string, string> = {
  'course.md': fm(['id: CS', 'title: CS50', 'type: course', 'course_status: active']),
  'ch0.md': fm([
    'id: CH0',
    'title: Week 0',
    'type: chapter',
    'chapter_course: "[[CS]]"',
    'chapter_order: 0',
  ]),
  'l0.md': fm([
    'id: L0',
    'title: Functions',
    'type: lesson',
    'lesson_chapter: "[[CH0]]"',
    'lesson_status: in-progress',
    'lesson_order: 0',
  ]),
  'l1.md': fm([
    'id: L1',
    'title: Loops',
    'type: lesson',
    'lesson_chapter: "[[CH0]]"',
    'lesson_status: todo',
    'lesson_order: 1',
  ]),
};

let term: Terminal | undefined;
afterEach(() => term?.unmount());

describe('courses tree screen', () => {
  it('opens via Space C, folds with h/l, and marks a lesson done with d', async () => {
    const h = harness(
      (f) => {
        for (const [path, source] of Object.entries(files)) f.fs.files.set(path, source);
      },
      { plugins: [coursesPlugin] },
    );
    term = h.start();
    await term.waitFor('notes');

    await term.press(' ', 'C');
    const open = await term.waitFor('CS50');
    expect(open).toContain('Courses'); // the frame title
    expect(open).toContain('Chapters');
    expect(open).toContain('Functions'); // the in-progress chapter is expanded
    expect(open).toContain('[done]'); // the todo lesson offers its inline verb

    // Fold the course, then expand it again.
    await term.press('h');
    const folded = await term.waitFor((f) => f.includes('CS50') && !f.includes('Chapters'));
    expect(folded).not.toContain('Functions');
    await term.press('l');
    await term.waitFor('Chapters');

    // Move to the Loops lesson (course, Chapters, Week 0, Functions, Loops) and mark it done.
    await term.press('j', 'j', 'j', 'j', 'd');
    const done = await term.waitFor((f) => f.includes('✓ Loops'));
    // Loops is now done (no verb); Functions, still in progress, keeps its own [done].
    expect(done).toMatch(/✓ Loops(?! \[done\])/);
    expect(done).toContain('Updated l1.md');
  });

  it('logs time from the leader menu through the input form', async () => {
    const h = harness(
      (f) => {
        for (const [path, source] of Object.entries(files)) f.fs.files.set(path, source);
      },
      { plugins: [coursesPlugin] },
    );
    term = h.start();
    await term.waitFor('notes');
    await term.press(' ', 'C');
    await term.waitFor('CS50');

    // Leader → log: the course menu verb opens the input form.
    await term.press(' ', 'l');
    await term.waitFor('amount');
    await term.type('45');
    await term.press(KEYS.enter); // amount → unit (enum, minutes default)
    await term.waitFor('hours');
    await term.press(KEYS.enter); // pick minutes → submit

    const logged = await term.waitFor('Logged 45');
    expect(logged).toContain('45m'); // the course headline now carries the study time
  });
});
