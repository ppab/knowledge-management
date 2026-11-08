import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/*
 * Markdown → HTML fragment for the `html` destination. GFM tables, task lists, strikethrough and
 * fenced code are rendered; raw HTML in a note passes through verbatim (`allowDangerousHtml`), on
 * the understanding that a fragment is meant for a static-site generator to embed, not to serve
 * untrusted input. No `rehype-raw`: the raw HTML is re-emitted as written, not re-parsed.
 */
const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

export const markdownToHtml = (markdown: string): string =>
  String(htmlProcessor.processSync(markdown));
