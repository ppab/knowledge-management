/*
 * Built-in templates, reachable as `--template goals/goal` and `--template goals/session`; a
 * vault's own `.notes/templates/goals/*.md` takes precedence. Numeric fields are left out on
 * purpose: a `{{placeholder}}` always substitutes as a YAML string, so `goal_target` and
 * `session_amount` are written as numbers by the plugin's commands (docs/goals.md §2).
 */

export const GOAL_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: goal
goal_unit: hours
goal_status: active
---

# {{title}}

## Why

## Strategy

## Risks

`;

export const SESSION_TEMPLATE = `---
id: "{{id}}"
title: "{{title}}"
type: session
session_goal: "[[{{session_goal}}]]"
session_status: confirmed
dates: ["{{date}}"]
---

# {{title}}

`;
