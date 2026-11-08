import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './html.js';

describe('markdownToHtml', () => {
  it('renders a GFM table', () => {
    const html = markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders a task list', () => {
    const html = markdownToHtml('- [x] done\n- [ ] todo\n');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('renders strikethrough', () => {
    expect(markdownToHtml('~~gone~~')).toContain('<del>gone</del>');
  });

  it('renders fenced code with a language class', () => {
    const html = markdownToHtml('```js\nconst x = 1;\n```\n');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-js');
  });

  it('passes raw HTML through verbatim', () => {
    expect(markdownToHtml('<div class="x">hi</div>')).toContain('<div class="x">hi</div>');
  });
});
