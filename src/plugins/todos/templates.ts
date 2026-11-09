/** `--template todos/task`; a vault's own `.ofl/templates/todos/task.md` takes precedence. */
export const TASK_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: todo
status: open
---

# {{title}}

`;
