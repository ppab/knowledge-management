/*
 * Built-in templates, reachable as `--template courses/course`, `courses/chapter`,
 * `courses/lesson` and `courses/study`; a vault's own `.notes/templates/courses/*.md` wins.
 * Numeric fields (`*_order`, `study_amount`, `lesson_duration`) are left out on purpose: a
 * `{{placeholder}}` always substitutes as a YAML string, so a command writes them as real
 * numbers (docs/courses.md §4). A chapter, lesson or study note is created with its parent id
 * filled into `{{course}}` / `{{chapter}}` so its link is a field reference from the start.
 */

export const COURSE_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: course
course_status: active
---

# {{title}}

## Notes

`;

export const CHAPTER_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: chapter
chapter_course: "[[{{course}}]]"
---

# {{title}}

`;

export const LESSON_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: lesson
lesson_chapter: "[[{{chapter}}]]"
lesson_status: todo
---

# {{title}}

## Notes

`;

export const STUDY_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: study
study_course: "[[{{course}}]]"
dates: ["{{date}}"]
template:
  path: "studies/{{date}}-{{id}}.md"
---

# {{title}}

`;
