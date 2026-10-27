---
id: FIX1
title: Prose fixture
---

# Prose fixture

Our architecture uses an _asynchronous_ **ingestion** pipeline with `inline code`, a
reference to [[TARGET1]] and a labelled one to [[TARGET2|the second target]] and a
[link](https://example.test/path) and ~~struck~~ text plus an escape \* and an entity &amp;.
A very long paragraph follows so that wrapping has to happen at several widths and the mapping
back to the source stays exact for every single piece of text that ends up on its own line.

- first item with [[TARGET3]]
- second item that is long enough to wrap when the width is small, really it is
  - nested item
- [x] done task
- [ ] open task

1. one
2. two

> quoted _text_ with [[TARGET4|quoted ref]]
> second quote line

```ts
const x = [[NOTREF]];
```

| a   | b   |
| --- | --- |
| 1   | 2   |

---

Line with a hard break  
after the break.

![alt text](img.png) and a supercalifragilisticexpialidocious-word-that-will-not-fit-in-twenty-columns end.
