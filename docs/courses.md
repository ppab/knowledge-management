# Courses: the contract

Status: delivery A, 2026-11-08. This document fixes the Markdown, the rules and the invariants of
the `courses` plugin before any command exists. A later delivery adds commands and TUI panels; where
a rule needs one, the section says so. The plugin mirrors `goals`: a container type whose progress is
**derived from child notes**, never stored as a counter.

Courses model the **content** of an online course as a hierarchy — course → chapter → lesson — and,
separately, the **study sessions** (time spent) that ride alongside it. Goals are a different concern:
a course may reference a goal note from the [`goals`](./goals.md) plugin, but `courses` does not model
goals — a course→goal link is an ordinary note reference. Markdown stays the source of truth; the
index can be deleted and rebuilt without losing a course, a lesson or a study session.

## 1. Notes

Four owned types, one note each, no imposed directories. Every field is prefixed by its type, because
the registry rejects a field name declared with different enum values by two plugins (`docs/plugins.md`
§2). Parent links are `reference` fields holding `"[[id]]"`; children are grouped by comparing the
parsed target to the parent id (the `goals` idiom, `parseFieldReference`). Sequence is a numeric
`*_order` field, sorted in memory.

### 1.1 Course (`type: course`)

```markdown
---
id: 01JB…
title: CS50
type: course
course_provider: edX
course_url: https://cs50.harvard.edu
course_instructor: David Malan
course_status: active
---

# CS50

## Notes
```

`course_status` is one of `active | completed | paused | dropped` (required). `course_provider`,
`course_url` and `course_instructor` are optional text.

### 1.2 Chapter (`type: chapter`)

```markdown
---
id: 01JC…
title: Week 0 — Scratch
type: chapter
chapter_course: '[[01JB…]]'
chapter_order: 0
---

# Week 0 — Scratch
```

`chapter_course` (reference, required) points at the course. `chapter_order` sequences chapters within
the course.

### 1.3 Lesson (`type: lesson`)

```markdown
---
id: 01JD…
title: Functions
type: lesson
lesson_chapter: '[[01JC…]]'
lesson_order: 2
lesson_status: in-progress
lesson_url: https://cs50.harvard.edu/x/weeks/0/
lesson_duration: 45
---

# Functions

## Notes
```

`lesson_chapter` (reference, required) points at the chapter. `lesson_status` is one of
`todo | in-progress | done` (required). `lesson_order` sequences lessons within the chapter.
`lesson_url` (text) and `lesson_duration` (minutes) are optional. The lesson is the note where study
notes are written.

### 1.4 Study (`type: study`)

```markdown
---
id: 01JE…
title: C basics, afternoon
type: study
study_course: '[[01JB…]]'
study_lesson: '[[01JD…]]'
study_amount: 90
study_unit: minutes
dates: ['2026-11-08']
---

# C basics, afternoon
```

A study session is a completed record of time spent. `study_course` (reference, required) is stored
directly so per-course totals are a single filter even when no lesson is named; `study_lesson`
(reference) is optional. `study_amount` is a number in `study_unit` (default `minutes`; `hours` and
`minutes` convert). The work day is the first `dates:` entry. `study_started` / `study_ended` (ISO 8601
instants with offset) are optional scaffolding for a future start/stop timer and are unused by this
delivery.

## 2. Progress (derived)

Progress is computed from child notes, never read from a counter on the course:

- **Lessons.** Gather the course's chapters (`chapter_course` = course id), ordered by
  `chapter_order`; for each, its lessons (`lesson_chapter` = chapter id), ordered by `lesson_order`.
  `doneLessons` counts `lesson_status: done`; `percent = done / total`.
- **Time.** Sum `study_amount` of the course's study sessions, each converted to minutes.
- **Format.** e.g. `3/24 lessons · 6h30m`.

Only notes whose metadata satisfies the contract contribute; the rest are reported by `doctor` (§3)
and excluded, so nothing half-understood reaches the totals.

## 3. Doctor checks

`doctor` runs declared-field validation first (type, required, enum — generic), then these plugin
checks, each loading the scope with `api.list()`:

- **`invalid`** — a course, chapter, lesson or study note whose metadata fails the contract (missing
  required reference, unknown enum value, non-numeric amount/order). Severity `warning`; the message
  lists the problems.
- **`orphan`** — a chapter whose `chapter_course` resolves to no course in scope; a lesson whose
  `lesson_chapter` resolves to no chapter; a study whose `study_course` (or set `study_lesson`)
  resolves to nothing. Severity `warning`.

A check never makes `doctor` exit non-zero (no `error` severity): the file is still a valid note.

## 4. Delivery scope

**Delivery A (this document).** The four types, their `FieldSpec`s, the four templates
(`courses/course`, `courses/chapter`, `courses/lesson`, `courses/study`), the derived-progress
functions, and the two doctor checks. Registered in `src/plugins/index.ts`; enabled per vault with
`plugins: { courses: {} }`. Tested against the `test/` fakes like `goals`. A small local units helper
handles minutes/hours, because the layer boundary forbids importing another plugin's code.

**Later deliveries.** Commands (`courses outline`, `courses done <lesson>`, `courses log <course>
<amount>`, timer `start`/`stop`) via `api.setFields` / `api.create`, modeled on `todos`; and TUI
panels (home `Courses` with progress bars, a note panel showing a course's tree), on the panel
registry. No change to `goals` or to a shared units module is in scope.
